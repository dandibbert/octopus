package migrate

import (
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 18,
		Up:      migrateBillingIdentityMetadata,
	})
}

func migrateBillingIdentityMetadata(db *gorm.DB) error {
	var rows []model.LLMInfo
	if err := db.Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		name := strings.ToLower(strings.TrimSpace(row.Name))
		mode := row.PriceMode
		needsReview := row.NeedsReview
		if !mode.Valid() {
			mode = model.PriceUnknown
		}
		if row.Input != 0 || row.Output != 0 || row.CacheRead != 0 || row.CacheWrite != 0 {
			if mode == model.PriceUnknown {
				mode = model.PriceExplicit
			}
			needsReview = false
		} else if mode != model.PriceFree {
			mode = model.PriceUnknown
			needsReview = true
		}
		updates := map[string]any{
			"canonical_model_id": firstNonEmptyBillingValue(row.CanonicalModelID, name),
			"billing_class_id":   firstNonEmptyBillingValue(row.BillingClassID, name),
			"price_mode":         mode,
			"price_source":       firstNonEmptyBillingValue(row.PriceSource, "legacy"),
			"needs_review":       needsReview,
		}
		if err := db.Model(&model.LLMInfo{}).Where("name = ?", row.Name).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}

func firstNonEmptyBillingValue(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}
