package op

import (
	"context"
	"path/filepath"
	"testing"

	dbpkg "github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
)

func setupDirectRouteTest(t *testing.T) context.Context {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "octopus-direct.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if err := InitCache(); err != nil {
		t.Fatalf("InitCache failed: %v", err)
	}
	t.Cleanup(func() { _ = dbpkg.Close() })
	return context.Background()
}

func TestResolveDirectChannelGroupUsesCacheWithoutDBWrite(t *testing.T) {
	ctx := setupDirectRouteTest(t)
	channel := &model.Channel{
		Name: "direct-channel", Enabled: true, Model: "direct-model",
	}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatal(err)
	}

	group, ok := ResolveDirectChannelGroup("direct-channel/direct-model", "", ctx)
	if !ok {
		t.Fatal("expected direct route")
	}
	if group.ID != -channel.ID || len(group.Items) != 1 || group.Items[0].ModelName != "direct-model" {
		t.Fatalf("unexpected group: %+v", group)
	}

	if _, ok := ResolveDirectChannelGroup("direct-channel/direct-model", "allowed-group", ctx); ok {
		t.Fatal("restricted keys must not use the direct escape hatch")
	}
	if _, ok := ResolveDirectChannelGroup("direct-channel/missing-model", "", ctx); ok {
		t.Fatal("unsupported model should fail")
	}
}

func TestResolveEnabledGroupOrDirectPrefersRealGroup(t *testing.T) {
	ctx := setupDirectRouteTest(t)
	channel := &model.Channel{Name: "direct-channel", Enabled: true, Model: "direct-model"}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatal(err)
	}
	real := &model.Group{Name: "direct-channel/direct-model", Mode: model.GroupModeFailover}
	if err := GroupCreate(real, ctx); err != nil {
		t.Fatal(err)
	}

	group, err := ResolveEnabledGroupOrDirect("direct-channel/direct-model", "", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if group.ID != real.ID {
		t.Fatalf("expected real group %d, got %d", real.ID, group.ID)
	}
}
