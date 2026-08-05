package price

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
)

func TestBillingBasisAndDualLedger(t *testing.T) {
	ctx := setupPriceTestDB(t)
	routed := testCatalogEntry("openai", "oct-routed", 1, 2)
	actual := testCatalogEntry("openai", "oct-actual", 3, 4)
	installTestCatalog(t, routed, actual)

	premium := model.LLMInfo{
		Name:             "product:oct-premium",
		CanonicalModelID: "product:oct-premium",
		BillingClassID:   "product:oct-premium",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 10, Output: 20},
	}
	if err := op.LLMCreate(premium, ctx); err != nil {
		t.Fatalf("create premium price: %v", err)
	}

	channel := model.Channel{
		ID:                    7,
		Type:                  outbound.OutboundTypeOpenAIChat,
		Provider:              "openai",
		BillingBasis:          model.BillingByActual,
		BillingUnknownPolicy:  model.UnknownUseRouted,
		ProviderUnknownPolicy: model.UnknownUseRouted,
	}

	tests := []struct {
		name           string
		item           model.GroupItem
		actualModel    string
		wantBilledIn   float64
		wantProviderIn float64
		wantMethod     string
		wantMismatch   bool
	}{
		{
			name:         "actual",
			item:         model.GroupItem{ID: 1, ModelName: routed.ModelID, BillingBasis: model.BillingByActual},
			actualModel:  "openai/" + actual.ModelID,
			wantBilledIn: 3, wantProviderIn: 3, wantMethod: "provider_prefix", wantMismatch: true,
		},
		{
			name:         "requested product sku",
			item:         model.GroupItem{ID: 2, ModelName: routed.ModelID, BillingBasis: model.BillingByRequested, BillingClassID: "product:oct-premium"},
			actualModel:  routed.ModelID,
			wantBilledIn: 10, wantProviderIn: 1, wantMethod: "route_binding",
		},
		{
			name:         "routed",
			item:         model.GroupItem{ID: 3, ModelName: routed.ModelID, BillingBasis: model.BillingByRouted},
			actualModel:  actual.ModelID,
			wantBilledIn: 1, wantProviderIn: 3, wantMethod: "exact", wantMismatch: true,
		},
		{
			name:         "fixed sku",
			item:         model.GroupItem{ID: 4, ModelName: routed.ModelID, BillingBasis: model.BillingByFixedSKU, BillingClassID: "product:oct-premium"},
			actualModel:  actual.ModelID,
			wantBilledIn: 10, wantProviderIn: 3, wantMethod: "fixed_sku", wantMismatch: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := BuildBillingPlan("smart", channel, tc.item, true)
			if err != nil {
				t.Fatalf("BuildBillingPlan failed: %v", err)
			}
			_, providerPrice, billedPrice, mismatch := ResolveFinalBilling(plan, tc.actualModel)
			if billedPrice.Price == nil || billedPrice.Price.Input != tc.wantBilledIn {
				t.Fatalf("unexpected billed price: %+v", billedPrice)
			}
			if providerPrice.Price == nil || providerPrice.Price.Input != tc.wantProviderIn {
				t.Fatalf("unexpected provider price: %+v", providerPrice)
			}
			if billedPrice.Method != tc.wantMethod {
				t.Fatalf("unexpected billed method %q, want %q", billedPrice.Method, tc.wantMethod)
			}
			if mismatch != tc.wantMismatch {
				t.Fatalf("unexpected mismatch=%v, want %v", mismatch, tc.wantMismatch)
			}
		})
	}
}

func TestUnknownBillingPolicyFallbacks(t *testing.T) {
	setupPriceTestDB(t)
	routed := testCatalogEntry("openai", "oct-fallback", 5, 6)
	installTestCatalog(t, routed)
	channel := model.Channel{ID: 8, Provider: "openai", Type: outbound.OutboundTypeOpenAIChat, ProviderUnknownPolicy: model.UnknownUseRouted}

	routedFallbackItem := model.GroupItem{
		ID: 1, ModelName: routed.ModelID, BillingBasis: model.BillingByRequested,
		BillingClassID: "product:missing", BillingUnknownPolicy: model.UnknownUseRouted,
	}
	plan, err := BuildBillingPlan("smart", channel, routedFallbackItem, false)
	if err != nil {
		t.Fatalf("routed fallback plan failed: %v", err)
	}
	_, _, billed, _ := ResolveFinalBilling(plan, routed.ModelID)
	if billed.Method != "route_fallback" || billed.Price == nil || billed.Price.Input != 5 || !billed.Estimated {
		t.Fatalf("unexpected routed fallback: %+v", billed)
	}

	actualFallbackItem := routedFallbackItem
	actualFallbackItem.ID = 2
	actualFallbackItem.BillingUnknownPolicy = model.UnknownUseActual
	plan, err = BuildBillingPlan("smart", channel, actualFallbackItem, false)
	if err != nil {
		t.Fatalf("actual fallback plan failed: %v", err)
	}
	_, _, billed, _ = ResolveFinalBilling(plan, routed.ModelID)
	if billed.Method != "actual_override" || billed.Price == nil || billed.Price.Input != 5 {
		t.Fatalf("unexpected actual fallback: %+v", billed)
	}
}

func TestCalculateCostUsesNormalizedUsageForBothLedgers(t *testing.T) {
	priceResolution := model.PriceResolution{
		Price:     &model.LLMPrice{Input: 10, CacheRead: 1, CacheWrite: 12.5, Output: 50},
		PriceMode: model.PriceExplicit,
		Status:    model.BillingStatusResolved,
	}
	cost := CalculateCost(1_000_000, 2_000_000, 400_000, 100_000, priceResolution)
	if cost.Input != 17 || cost.Output != 5 || cost.Total != 22 {
		t.Fatalf("unexpected cost: %+v", cost)
	}

	unknown := CalculateCost(1, 0, 0, 0, model.PriceResolution{PriceMode: model.PriceUnknown, Status: model.BillingStatusUnknown})
	if unknown.Status != model.BillingStatusUnknown || unknown.Total != 0 {
		t.Fatalf("unknown price was treated as free/resolved: %+v", unknown)
	}
}
