package op

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	dbpkg "github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/pquerna/otp/totp"
)

func setupTwoFactorTest(t *testing.T) {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "octopus-2fa.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	userCache = model.User{}
	if err := UserInit(); err != nil {
		t.Fatalf("UserInit failed: %v", err)
	}
	if err := InitCache(); err != nil {
		t.Fatalf("InitCache failed: %v", err)
	}
	t.Cleanup(func() {
		totpGuard.reset()
		totpGuard.clearPending()
		_ = dbpkg.Close()
	})
	totpGuard.reset()
	totpGuard.clearPending()
}

func currentTOTP(t *testing.T, secret string) string {
	t.Helper()
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	return code
}

func TestTwoFactorSetupKeepsSecretPendingUntilEnable(t *testing.T) {
	setupTwoFactorTest(t)

	setup, err := TwoFactorSetup()
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if setup.Secret == "" || setup.QRCode == "" {
		t.Fatalf("expected secret and qr, got %+v", setup)
	}
	if userCache.TwoFactorSecret != "" {
		t.Fatalf("setup should not persist secret, got %q", userCache.TwoFactorSecret)
	}
	if !TwoFactorEnabled() && totpGuard.pendingSecret() != setup.Secret {
		t.Fatalf("pending secret mismatch")
	}

	if err := TwoFactorEnable(currentTOTP(t, setup.Secret)); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !TwoFactorEnabled() {
		t.Fatal("expected 2FA enabled")
	}
	if userCache.TwoFactorSecret != setup.Secret {
		t.Fatalf("secret not persisted after enable")
	}
	if totpGuard.pendingSecret() != "" {
		t.Fatal("pending secret should be cleared after enable")
	}
}

func TestTwoFactorEnableWithoutSetupFails(t *testing.T) {
	setupTwoFactorTest(t)
	if err := TwoFactorEnable("123456"); !errors.Is(err, ErrTwoFactorNotSetUp) {
		t.Fatalf("expected not set up, got %v", err)
	}
}

func TestTwoFactorDisableRequiresValidCode(t *testing.T) {
	setupTwoFactorTest(t)
	setup, err := TwoFactorSetup()
	if err != nil {
		t.Fatal(err)
	}
	if err := TwoFactorEnable(currentTOTP(t, setup.Secret)); err != nil {
		t.Fatal(err)
	}
	if err := TwoFactorDisable("000000"); !errors.Is(err, ErrTwoFactorInvalid) {
		t.Fatalf("expected invalid code, got %v", err)
	}
	if !TwoFactorEnabled() {
		t.Fatal("invalid disable should leave 2FA enabled")
	}
	if err := TwoFactorDisable(currentTOTP(t, setup.Secret)); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if TwoFactorEnabled() {
		t.Fatal("expected 2FA disabled")
	}
	if userCache.TwoFactorSecret != "" {
		t.Fatal("secret should be cleared after disable")
	}
}

func TestTwoFactorVerifyLoginLocksAfterFailures(t *testing.T) {
	setupTwoFactorTest(t)
	setup, err := TwoFactorSetup()
	if err != nil {
		t.Fatal(err)
	}
	if err := TwoFactorEnable(currentTOTP(t, setup.Secret)); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < twoFactorMaxFailures; i++ {
		if err := TwoFactorVerifyLogin("000000"); !errors.Is(err, ErrTwoFactorInvalid) {
			t.Fatalf("attempt %d: expected invalid, got %v", i, err)
		}
	}
	if err := TwoFactorVerifyLogin(currentTOTP(t, setup.Secret)); !errors.Is(err, ErrTwoFactorLocked) {
		t.Fatalf("expected lock, got %v", err)
	}
	locked, remaining := TwoFactorLocked()
	if !locked || remaining <= 0 {
		t.Fatalf("expected remaining lock, locked=%v remaining=%v", locked, remaining)
	}
}

func TestTwoFactorForceDisableClearsState(t *testing.T) {
	setupTwoFactorTest(t)
	setup, err := TwoFactorSetup()
	if err != nil {
		t.Fatal(err)
	}
	if err := TwoFactorEnable(currentTOTP(t, setup.Secret)); err != nil {
		t.Fatal(err)
	}
	if err := TwoFactorForceDisable(); err != nil {
		t.Fatal(err)
	}
	if TwoFactorEnabled() {
		t.Fatal("expected force disable")
	}
	if err := TwoFactorVerifyLogin(""); err != nil {
		t.Fatalf("password-only login should pass after force disable: %v", err)
	}
}
