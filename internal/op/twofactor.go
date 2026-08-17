package op

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image/png"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/conf"
	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	totpSkew              = 1
	twoFactorMaxFailures  = 5
	twoFactorLockDuration = 5 * time.Minute
)

var (
	ErrTwoFactorLocked     = errors.New("too many failed attempts")
	ErrTwoFactorInvalid    = errors.New("invalid verification code")
	ErrTwoFactorEnabled    = errors.New("two factor authentication is already enabled")
	ErrTwoFactorDisabled   = errors.New("two factor authentication is not enabled")
	ErrTwoFactorNotSetUp   = errors.New("two factor authentication is not set up")
)

type twoFactorGuard struct {
	mu         sync.Mutex
	failures   int
	lockedTill time.Time
	pending    string
}

var totpGuard twoFactorGuard

func (g *twoFactorGuard) locked() (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	remaining := time.Until(g.lockedTill)
	return remaining > 0, remaining
}

func (g *twoFactorGuard) recordFailure() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.failures++
	if g.failures >= twoFactorMaxFailures {
		g.lockedTill = time.Now().Add(twoFactorLockDuration)
		g.failures = 0
	}
}

func (g *twoFactorGuard) reset() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.failures = 0
	g.lockedTill = time.Time{}
}

func (g *twoFactorGuard) setPending(secret string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.pending = secret
}

func (g *twoFactorGuard) pendingSecret() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.pending
}

func (g *twoFactorGuard) clearPending() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.pending = ""
}

func TwoFactorEnabled() bool {
	enabled, err := SettingGetBool(model.SettingKeyTwoFactorEnabled)
	return err == nil && enabled
}

func TwoFactorLocked() (bool, time.Duration) {
	return totpGuard.locked()
}

func TwoFactorLockError(remaining time.Duration) error {
	seconds := int(remaining.Seconds()) + 1
	return fmt.Errorf("%w, retry in %d seconds", ErrTwoFactorLocked, seconds)
}

func TwoFactorSetup() (*model.TwoFactorSetupResponse, error) {
	if TwoFactorEnabled() {
		return nil, ErrTwoFactorEnabled
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: conf.APP_NAME, AccountName: userCache.Username})
	if err != nil {
		return nil, fmt.Errorf("failed to generate totp key: %w", err)
	}
	// Keep the secret in memory until Enable succeeds. Persisting here would
	// leave an unused secret in the database if the user never confirms.
	totpGuard.setPending(key.Secret())
	image, err := key.Image(256, 256)
	if err != nil {
		return nil, fmt.Errorf("failed to render qr code: %w", err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, image); err != nil {
		return nil, fmt.Errorf("failed to encode qr code: %w", err)
	}
	return &model.TwoFactorSetupResponse{
		Secret: key.Secret(),
		URI:    key.URL(),
		QRCode: "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

func TwoFactorEnable(code string) error {
	if TwoFactorEnabled() {
		return ErrTwoFactorEnabled
	}
	secret := totpGuard.pendingSecret()
	if secret == "" {
		secret = userCache.TwoFactorSecret
	}
	if secret == "" {
		return ErrTwoFactorNotSetUp
	}
	if err := verifyTOTPSecret(code, secret); err != nil {
		return err
	}
	if err := userSetTwoFactorSecret(secret); err != nil {
		return err
	}
	if err := SettingSetString(model.SettingKeyTwoFactorEnabled, "true"); err != nil {
		return err
	}
	totpGuard.clearPending()
	return nil
}

func TwoFactorDisable(code string) error {
	if !TwoFactorEnabled() {
		return ErrTwoFactorDisabled
	}
	if err := verifyTOTPSecret(code, userCache.TwoFactorSecret); err != nil {
		return err
	}
	return TwoFactorForceDisable()
}

// TwoFactorForceDisable is an operator recovery path for a lost authenticator.
// Invoking the CLI already requires server shell access. The running server
// process keeps settings in memory, so it must be restarted after this command.
func TwoFactorForceDisable() error {
	if err := SettingSetString(model.SettingKeyTwoFactorEnabled, "false"); err != nil {
		return err
	}
	if err := userSetTwoFactorSecret(""); err != nil {
		return err
	}
	totpGuard.clearPending()
	totpGuard.reset()
	return nil
}

func TwoFactorVerifyLogin(code string) error {
	if !TwoFactorEnabled() {
		return nil
	}
	return verifyTOTPSecret(code, userCache.TwoFactorSecret)
}

func verifyTOTPSecret(code, secret string) error {
	if locked, remaining := totpGuard.locked(); locked {
		return TwoFactorLockError(remaining)
	}
	if secret == "" {
		return ErrTwoFactorNotSetUp
	}
	if code == "" {
		totpGuard.recordFailure()
		return ErrTwoFactorInvalid
	}
	valid, err := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period: 30, Skew: totpSkew, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil || !valid {
		totpGuard.recordFailure()
		return ErrTwoFactorInvalid
	}
	totpGuard.reset()
	return nil
}

func userSetTwoFactorSecret(secret string) error {
	userCache.TwoFactorSecret = secret
	if err := db.GetDB().Model(&userCache).Update("two_factor_secret", secret).Error; err != nil {
		return fmt.Errorf("failed to update two factor secret: %w", err)
	}
	return nil
}
