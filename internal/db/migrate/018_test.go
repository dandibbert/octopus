package migrate

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestMigrateBillingIdentityMetadataSeparatesUnknownAndFree(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.LLMInfo{}); err != nil {
		t.Fatalf("auto migrate LLMInfo: %v", err)
	}
	rows := []model.LLMInfo{
		{Name: "paid-model", LLMPrice: model.LLMPrice{Input: 1}},
		{Name: "legacy-zero"},
		{Name: "explicit-free", PriceMode: model.PriceFree},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("create fixtures: %v", err)
	}

	if err := migrateBillingIdentityMetadata(db); err != nil {
		t.Fatalf("migrateBillingIdentityMetadata: %v", err)
	}

	var paid model.LLMInfo
	if err := db.First(&paid, "name = ?", "paid-model").Error; err != nil {
		t.Fatalf("load paid model: %v", err)
	}
	if paid.PriceMode != model.PriceExplicit || paid.NeedsReview {
		t.Fatalf("expected paid model to become explicit without review: %+v", paid)
	}
	if paid.CanonicalModelID != "paid-model" || paid.BillingClassID != "paid-model" {
		t.Fatalf("expected legacy identity fields to be backfilled: %+v", paid)
	}

	var unknown model.LLMInfo
	if err := db.First(&unknown, "name = ?", "legacy-zero").Error; err != nil {
		t.Fatalf("load unknown model: %v", err)
	}
	if unknown.PriceMode != model.PriceUnknown || !unknown.NeedsReview {
		t.Fatalf("expected legacy zero model to require review as unknown: %+v", unknown)
	}

	var free model.LLMInfo
	if err := db.First(&free, "name = ?", "explicit-free").Error; err != nil {
		t.Fatalf("load free model: %v", err)
	}
	if free.PriceMode != model.PriceFree || free.NeedsReview {
		t.Fatalf("expected explicit free state to be preserved: %+v", free)
	}
}
