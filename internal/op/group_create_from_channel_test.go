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

func setupCreateGroupFromChannelTest(t *testing.T) (context.Context, *model.Channel) {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "octopus.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	t.Cleanup(func() { _ = dbpkg.Close() })
	ctx := context.Background()
	channel := &model.Channel{Name: t.Name() + "-channel", Model: "gpt-test", Enabled: true}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("ChannelCreate failed: %v", err)
	}
	return ctx, channel
}

func TestGroupCreateFromChannelModelPersistsFirstItem(t *testing.T) {
	ctx, channel := setupCreateGroupFromChannelTest(t)
	group, err := GroupCreateFromChannelModel(channel.ID, "gpt-test", t.Name()+"-group", ctx)
	if err != nil {
		t.Fatalf("GroupCreateFromChannelModel failed: %v", err)
	}
	if group.ID <= 0 || len(group.Items) != 1 {
		t.Fatalf("expected persisted group with one item, got %+v", group)
	}
	item := group.Items[0]
	if item.GroupID != group.ID || item.ChannelID != channel.ID || item.ModelName != "gpt-test" {
		t.Fatalf("unexpected first item: %+v", item)
	}
}

func TestGroupCreateFromChannelModelRollsBackWhenItemCreateFails(t *testing.T) {
	ctx, channel := setupCreateGroupFromChannelTest(t)
	db := dbpkg.GetDB()
	callbackName := "test:fail_create_group_item"
	if err := db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "group_items" {
			tx.AddError(errors.New("injected group item failure"))
		}
	}); err != nil {
		t.Fatalf("register callback: %v", err)
	}
	t.Cleanup(func() { _ = db.Callback().Create().Remove(callbackName) })

	groupName := t.Name() + "-group"
	if _, err := GroupCreateFromChannelModel(channel.ID, "gpt-test", groupName, ctx); err == nil {
		t.Fatal("expected injected item creation failure")
	}
	var count int64
	if err := db.Model(&model.Group{}).Where("name = ?", groupName).Count(&count).Error; err != nil {
		t.Fatalf("count groups: %v", err)
	}
	if count != 0 {
		t.Fatalf("transaction left %d empty groups behind", count)
	}
}

func TestGroupCreateFromChannelModelRejectsDuplicateName(t *testing.T) {
	ctx, channel := setupCreateGroupFromChannelTest(t)
	groupName := t.Name() + "-group"
	if _, err := GroupCreateFromChannelModel(channel.ID, "gpt-test", groupName, ctx); err != nil {
		t.Fatalf("first create failed: %v", err)
	}
	if _, err := GroupCreateFromChannelModel(channel.ID, "gpt-test", groupName, ctx); !errors.Is(err, ErrGroupNameConflict) {
		t.Fatalf("expected ErrGroupNameConflict, got %v", err)
	}
}
