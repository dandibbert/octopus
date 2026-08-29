package op

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	dbpkg "github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"gorm.io/gorm"
)

func setupStatsChannelTestDB(t *testing.T) context.Context {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "octopus.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	t.Cleanup(func() { _ = dbpkg.Close() })

	ctx := context.Background()
	if err := statsRefreshCache(ctx); err != nil {
		t.Fatalf("statsRefreshCache failed: %v", err)
	}
	return ctx
}

func TestStatsChannelZeroIDDoesNotAttachToFreshChannel(t *testing.T) {
	ctx := setupStatsChannelTestDB(t)

	channel := &model.Channel{
		Name:    "fresh-channel",
		Enabled: true,
	}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("ChannelCreate failed: %v", err)
	}
	if channel.ID <= 0 {
		t.Fatalf("expected generated channel id, got %d", channel.ID)
	}

	// A request that fails before any channel attempt has channel_id=0. That
	// aggregate must never be persisted as channel stats: StatsChannel's integer
	// primary key is auto-incrementing in existing databases, so persisting a
	// zero key can otherwise be silently reassigned to a real channel ID.
	if err := StatsChannelUpdate(0, model.StatsMetrics{RequestFailed: 141}); err != nil {
		t.Fatalf("StatsChannelUpdate failed: %v", err)
	}
	if err := StatsSaveDB(ctx); err != nil {
		t.Fatalf("StatsSaveDB failed: %v", err)
	}

	var persisted model.StatsChannel
	result := dbpkg.GetDB().WithContext(ctx).Where("channel_id = ?", channel.ID).First(&persisted)
	if result.Error == nil {
		t.Fatalf("zero-id stats were attached to fresh channel %d: %+v", channel.ID, persisted)
	}
	if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		t.Fatalf("load fresh-channel stats failed: %v", result.Error)
	}

	// Simulate a restart/cache reload as that is when the phantom row becomes
	// visible in the channel detail UI.
	if err := statsRefreshCache(ctx); err != nil {
		t.Fatalf("statsRefreshCache after save failed: %v", err)
	}
	stats := StatsChannelGet(channel.ID)
	if stats.RequestFailed != 0 || stats.RequestSuccess != 0 {
		t.Fatalf("fresh channel inherited request stats after reload: %+v", stats)
	}
}

func TestStatsAPIKeyZeroIDDoesNotAttachToFreshAPIKey(t *testing.T) {
	ctx := setupStatsChannelTestDB(t)

	apiKey := &model.APIKey{
		Name:    "fresh-api-key",
		APIKey:  "sk-test-fresh",
		Enabled: true,
	}
	if err := APIKeyCreate(apiKey, ctx); err != nil {
		t.Fatalf("APIKeyCreate failed: %v", err)
	}
	if apiKey.ID <= 0 {
		t.Fatalf("expected generated api key id, got %d", apiKey.ID)
	}

	if err := StatsAPIKeyUpdate(0, model.StatsMetrics{RequestFailed: 141}); err != nil {
		t.Fatalf("StatsAPIKeyUpdate failed: %v", err)
	}
	if err := StatsSaveDB(ctx); err != nil {
		t.Fatalf("StatsSaveDB failed: %v", err)
	}

	var persisted model.StatsAPIKey
	result := dbpkg.GetDB().WithContext(ctx).Where("api_key_id = ?", apiKey.ID).First(&persisted)
	if result.Error == nil {
		t.Fatalf("zero-id stats were attached to fresh API key %d: %+v", apiKey.ID, persisted)
	}
	if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		t.Fatalf("load fresh API-key stats failed: %v", result.Error)
	}

	if err := statsRefreshCache(ctx); err != nil {
		t.Fatalf("statsRefreshCache after save failed: %v", err)
	}
	stats := StatsAPIKeyGet(apiKey.ID)
	if stats.RequestFailed != 0 || stats.RequestSuccess != 0 {
		t.Fatalf("fresh API key inherited request stats after reload: %+v", stats)
	}
}
