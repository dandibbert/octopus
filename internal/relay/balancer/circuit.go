package balancer

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/utils/log"
)

// CircuitState 熔断器状态
type CircuitState int

type FailureKind int

const (
	StateClosed   CircuitState = iota // 正常通行
	StateOpen                         // 熔断中，拒绝所有请求
	StateHalfOpen                     // 半开，仅允许单个试探请求

	FailureHard FailureKind = iota
	FailureSoftRateLimit
)

// circuitEntry 单个熔断器条目
type circuitEntry struct {
	State               CircuitState
	ConsecutiveFailures int64
	LastFailureTime     time.Time
	TripCount           int // 累计熔断触发次数（用于指数退避）
	HalfOpenSince       time.Time
	mu                  sync.Mutex
}

// 全局熔断器存储
var globalBreaker sync.Map // key: string -> value: *circuitEntry

type CircuitBreakerStatus struct {
	ChannelID           int    `json:"channel_id"`
	ChannelName         string `json:"channel_name"`
	KeyID               int    `json:"key_id"`
	ModelName           string `json:"model_name"`
	State               string `json:"state"`
	ConsecutiveFailures int64  `json:"consecutive_failures"`
	TripCount           int    `json:"trip_count"`
	RemainingCooldown   int64  `json:"remaining_cooldown"`
}

func IsCircuitBreakerEnabled() bool {
	enabled, err := op.SettingGetBool(model.SettingKeyCircuitBreakerEnabled)
	return err != nil || enabled
}

// circuitKey 生成熔断器键：channelID:channelKeyID:modelName
func circuitKey(channelID, keyID int, modelName string) string {
	return fmt.Sprintf("%d:%d:%s", channelID, keyID, modelName)
}

func resetCircuitBreakerByChannel(channelID int) {
	prefix := fmt.Sprintf("%d:", channelID)
	globalBreaker.Range(func(key, _ any) bool {
		if k, ok := key.(string); ok && strings.HasPrefix(k, prefix) {
			globalBreaker.Delete(k)
		}
		return true
	})
}

// getOrCreateEntry 获取或创建熔断器条目
func getOrCreateEntry(key string) *circuitEntry {
	if v, ok := globalBreaker.Load(key); ok {
		return v.(*circuitEntry)
	}
	entry := &circuitEntry{State: StateClosed}
	actual, _ := globalBreaker.LoadOrStore(key, entry)
	return actual.(*circuitEntry)
}

// getThreshold 获取熔断阈值配置
func getThreshold() int64 {
	v, err := op.SettingGetInt(model.SettingKeyCircuitBreakerThreshold)
	if err != nil || v <= 0 {
		return 5
	}
	return int64(v)
}

// GetCooldown 获取当前冷却时间（带指数退避）
func GetCooldown(tripCount int) time.Duration {
	base, err := op.SettingGetInt(model.SettingKeyCircuitBreakerCooldown)
	if err != nil || base <= 0 {
		base = 60
	}
	maxCooldown, err := op.SettingGetInt(model.SettingKeyCircuitBreakerMaxCooldown)
	if err != nil || maxCooldown <= 0 {
		maxCooldown = 600
	}

	// 指数退避：baseCooldown * 2^(tripCount-1)
	cooldown := base
	if tripCount > 1 {
		shift := tripCount - 1
		if shift > 20 { // 防止溢出
			shift = 20
		}
		cooldown = base << shift
	}
	if cooldown > maxCooldown {
		cooldown = maxCooldown
	}

	return time.Duration(cooldown) * time.Second
}

// IsTripped 检查通道是否处于熔断状态
// 返回 tripped=true 表示该通道应被跳过，remaining 为剩余冷却时间
func IsTripped(channelID, keyID int, modelName string) (tripped bool, remaining time.Duration) {
	if !IsCircuitBreakerEnabled() {
		return false, 0
	}
	key := circuitKey(channelID, keyID, modelName)
	v, ok := globalBreaker.Load(key)
	if !ok {
		return false, 0 // 无记录，视为 Closed
	}
	entry := v.(*circuitEntry)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	switch entry.State {
	case StateClosed:
		return false, 0

	case StateOpen:
		cooldown := GetCooldown(entry.TripCount)
		elapsed := time.Since(entry.LastFailureTime)
		if elapsed >= cooldown {
			now := time.Now()
			entry.State = StateHalfOpen
			entry.HalfOpenSince = now
			log.Infof("circuit breaker [%s] Open -> HalfOpen (cooldown %v elapsed)", key, cooldown)
			return false, 0
		}
		// 仍在冷却中
		return true, cooldown - elapsed

	case StateHalfOpen:
		cooldown := GetCooldown(entry.TripCount)
		if entry.HalfOpenSince.IsZero() {
			entry.HalfOpenSince = time.Now()
		}
		if time.Since(entry.HalfOpenSince) >= cooldown {
			entry.State = StateOpen
			entry.LastFailureTime = time.Now()
			entry.HalfOpenSince = time.Time{}
			log.Warnf("circuit breaker [%s] HalfOpen -> Open (probe timed out, cooldown=%v)", key, cooldown)
			return true, cooldown
		}
		// 已有试探请求在进行中，拒绝其他请求
		return true, 0

	default:
		return false, 0
	}
}

// RecordSuccess 记录成功，重置熔断器状态
func RecordSuccess(channelID, keyID int, modelName string) {
	if !IsCircuitBreakerEnabled() {
		return
	}
	key := circuitKey(channelID, keyID, modelName)
	v, ok := globalBreaker.Load(key)
	if !ok {
		return
	}
	entry := v.(*circuitEntry)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	if entry.State == StateHalfOpen {
		log.Infof("circuit breaker [%s] HalfOpen -> Closed (probe succeeded)", key)
	}

	// 重置全部状态
	entry.State = StateClosed
	entry.ConsecutiveFailures = 0
	entry.TripCount = 0
	entry.HalfOpenSince = time.Time{}
}

// RecordFailure 记录失败，可能触发熔断。
// FailureSoftRateLimit 用于 429/503 这类软失败：Closed 状态下不累计阈值，
// HalfOpen 状态下重新进入 Open，但不放大 TripCount。
func RecordFailure(channelID, keyID int, modelName string, kind FailureKind) {
	if !IsCircuitBreakerEnabled() {
		return
	}
	key := circuitKey(channelID, keyID, modelName)
	entry := getOrCreateEntry(key)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	entry.LastFailureTime = time.Now()
	entry.HalfOpenSince = time.Time{}

	switch entry.State {
	case StateClosed:
		if kind == FailureSoftRateLimit {
			return
		}
		entry.ConsecutiveFailures++
		threshold := getThreshold()
		if entry.ConsecutiveFailures >= threshold {
			entry.State = StateOpen
			entry.TripCount++
			log.Warnf("circuit breaker [%s] Closed -> Open (failures=%d >= threshold=%d, tripCount=%d, cooldown=%v)",
				key, entry.ConsecutiveFailures, threshold, entry.TripCount, GetCooldown(entry.TripCount))
		}

	case StateHalfOpen:
		if kind == FailureSoftRateLimit {
			entry.State = StateOpen
			log.Warnf("circuit breaker [%s] HalfOpen -> Open (soft rate limit, tripCount=%d, cooldown=%v)",
				key, entry.TripCount, GetCooldown(entry.TripCount))
			return
		}
		// 试探失败，重新进入 Open 状态，TripCount 递增（冷却时间翻倍）
		entry.State = StateOpen
		entry.TripCount++
		entry.ConsecutiveFailures = 0 // 重新开始计数
		log.Warnf("circuit breaker [%s] HalfOpen -> Open (probe failed, tripCount=%d, cooldown=%v)",
			key, entry.TripCount, GetCooldown(entry.TripCount))

	case StateOpen:
		// 理论上不应该在 Open 状态下接收到失败记录（请求应被拒绝），
		// 但为安全起见仍更新失败时间
	}
}

func ListTripped() []CircuitBreakerStatus {
	type pending struct {
		channelID int
		status    CircuitBreakerStatus
	}
	now := time.Now()
	pendingStatuses := make([]pending, 0)
	seenChannels := make(map[int]struct{})
	globalBreaker.Range(func(rawKey, rawValue any) bool {
		key, ok := rawKey.(string)
		entry, entryOK := rawValue.(*circuitEntry)
		if !ok || !entryOK {
			return true
		}
		parts := strings.SplitN(key, ":", 3)
		if len(parts) != 3 {
			return true
		}
		channelID, err1 := strconv.Atoi(parts[0])
		keyID, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil {
			return true
		}

		entry.mu.Lock()
		if entry.State == StateClosed {
			entry.mu.Unlock()
			return true
		}
		state := "open"
		remaining := int64(0)
		if entry.State == StateHalfOpen {
			state = "half_open"
		} else {
			left := GetCooldown(entry.TripCount) - now.Sub(entry.LastFailureTime)
			if left > 0 {
				remaining = int64(left.Round(time.Second) / time.Second)
			}
		}
		status := CircuitBreakerStatus{
			ChannelID: channelID, KeyID: keyID, ModelName: parts[2], State: state,
			ConsecutiveFailures: entry.ConsecutiveFailures,
			TripCount:           entry.TripCount, RemainingCooldown: remaining,
		}
		entry.mu.Unlock()
		pendingStatuses = append(pendingStatuses, pending{channelID: channelID, status: status})
		seenChannels[channelID] = struct{}{}
		return true
	})

	names := make(map[int]string, len(seenChannels))
	for channelID := range seenChannels {
		if channel, err := op.ChannelGet(channelID, context.Background()); err == nil && channel != nil {
			names[channelID] = channel.Name
		}
	}

	statuses := make([]CircuitBreakerStatus, 0, len(pendingStatuses))
	for _, item := range pendingStatuses {
		item.status.ChannelName = names[item.channelID]
		statuses = append(statuses, item.status)
	}
	sort.Slice(statuses, func(i, j int) bool {
		if statuses[i].ChannelID != statuses[j].ChannelID {
			return statuses[i].ChannelID < statuses[j].ChannelID
		}
		if statuses[i].KeyID != statuses[j].KeyID {
			return statuses[i].KeyID < statuses[j].KeyID
		}
		return statuses[i].ModelName < statuses[j].ModelName
	})
	return statuses
}

func ResetAll() {
	keys := make([]any, 0)
	globalBreaker.Range(func(key, _ any) bool {
		keys = append(keys, key)
		return true
	})
	for _, key := range keys {
		globalBreaker.Delete(key)
	}
}
