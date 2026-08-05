package op

import (
	"errors"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func TestNormalizeGroupItemBillingRequiresSKUForProductModes(t *testing.T) {
	for _, basis := range []model.BillingBasis{model.BillingByRequested, model.BillingByFixedSKU} {
		item := model.GroupItem{ModelName: "test-model", BillingBasis: basis}
		err := normalizeGroupItemBilling(&item)
		if !errors.Is(err, ErrInvalidGroupBilling) {
			t.Fatalf("basis %s: expected ErrInvalidGroupBilling, got %v", basis, err)
		}
	}
}

func TestNormalizeGroupItemBillingAllowsInheritedDefaults(t *testing.T) {
	item := model.GroupItem{ModelName: "test-model"}
	if err := normalizeGroupItemBilling(&item); err != nil {
		t.Fatalf("default inherited billing should be valid: %v", err)
	}
}
