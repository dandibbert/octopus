package price

import (
	"errors"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
)

func attachErrorCode(t *testing.T, err error) string {
	t.Helper()
	var attachErr *ModelAliasAttachError
	if !errors.As(err, &attachErr) {
		t.Fatalf("expected ModelAliasAttachError, got %T: %v", err, err)
	}
	return attachErr.Code
}

func TestAttachModelAliasRejectsCatalogPricedSource(t *testing.T) {
	ctx := setupPriceTestDB(t)
	source := testCatalogEntry("fireworks", "already-priced", 1, 2)
	target := testCatalogEntry("fireworks", "priced-target", 3, 4)
	installTestCatalog(t, source, target)

	_, err := AttachModelAlias(ctx, model.ModelAliasAttachRequest{
		Alias:            source.ModelID,
		CanonicalModelID: target.CanonicalModelID,
		BillingClassID:   target.BillingClassID,
		Provider:         "fireworks",
	})
	if code := attachErrorCode(t, err); code != ModelAliasAttachCodeSourcePriceConflict {
		t.Fatalf("unexpected error code: %q", code)
	}
	if _, _, ok := op.ModelAliasResolve(0, "fireworks", source.ModelID); ok {
		t.Fatal("catalog-priced source was attached")
	}
}

func TestAttachModelAliasReplaceAllowsOldUnknownAlias(t *testing.T) {
	ctx := setupPriceTestDB(t)
	target := testCatalogEntry("fireworks", "priced-target", 3, 4)
	installTestCatalog(t, target)
	old := model.ModelAlias{
		Provider:         "fireworks",
		Alias:            "unknown-source",
		CanonicalModelID: "fireworks:missing",
		BillingClassID:   "fireworks:missing/default",
		Enabled:          true,
	}
	if err := op.ModelAliasCreate(&old, ctx); err != nil {
		t.Fatalf("create old alias: %v", err)
	}

	result, err := AttachModelAlias(ctx, model.ModelAliasAttachRequest{
		Alias:            old.Alias,
		CanonicalModelID: target.CanonicalModelID,
		BillingClassID:   target.BillingClassID,
		Provider:         "fireworks",
		ConflictPolicy:   model.ModelAliasConflictReplace,
	})
	if err != nil {
		t.Fatalf("replace unknown alias: %v", err)
	}
	if result.Alias.ID != old.ID || result.ModelResolution.AliasID == nil || *result.ModelResolution.AliasID != old.ID {
		t.Fatalf("unexpected replacement response: %+v", result)
	}
	if result.PriceResolution.Method != "provider_alias" || result.PriceResolution.Price == nil {
		t.Fatalf("response was not constructed as final resolution: %+v", result.PriceResolution)
	}
}

func TestAttachModelAliasRejectsMismatchedCanonicalAndBillingClass(t *testing.T) {
	ctx := setupPriceTestDB(t)
	first := model.LLMInfo{
		Name:             "first-target",
		CanonicalModelID: "product:first",
		BillingClassID:   "sku:first",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 1, Output: 2},
	}
	second := model.LLMInfo{
		Name:             "second-target",
		CanonicalModelID: "product:second",
		BillingClassID:   "sku:second",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 3, Output: 4},
	}
	for _, info := range []model.LLMInfo{first, second} {
		if err := op.LLMCreate(info, ctx); err != nil {
			t.Fatalf("create %q: %v", info.Name, err)
		}
	}

	_, err := AttachModelAlias(ctx, model.ModelAliasAttachRequest{
		Alias:            "unpriced-source",
		CanonicalModelID: first.CanonicalModelID,
		BillingClassID:   second.BillingClassID,
	})
	if code := attachErrorCode(t, err); code != ModelAliasAttachCodeInvalidRequest {
		t.Fatalf("unexpected error code: %q", code)
	}
}

func TestAttachModelAliasRequiresSKUWhenCanonicalHasMultiplePrices(t *testing.T) {
	ctx := setupPriceTestDB(t)
	canonicalID := "product:multi-price"
	for _, info := range []model.LLMInfo{
		{
			Name:             "multi-price-basic",
			CanonicalModelID: canonicalID,
			BillingClassID:   "sku:basic",
			PriceMode:        model.PriceExplicit,
			LLMPrice:         model.LLMPrice{Input: 1, Output: 2},
		},
		{
			Name:             "multi-price-premium",
			CanonicalModelID: canonicalID,
			BillingClassID:   "sku:premium",
			PriceMode:        model.PriceExplicit,
			LLMPrice:         model.LLMPrice{Input: 3, Output: 4},
		},
	} {
		if err := op.LLMCreate(info, ctx); err != nil {
			t.Fatalf("create %q: %v", info.Name, err)
		}
	}

	_, err := AttachModelAlias(ctx, model.ModelAliasAttachRequest{
		Alias:            "ambiguous-source",
		CanonicalModelID: canonicalID,
	})
	if code := attachErrorCode(t, err); code != ModelAliasAttachCodeInvalidRequest {
		t.Fatalf("unexpected error code: %q", code)
	}

	result, err := AttachModelAlias(ctx, model.ModelAliasAttachRequest{
		Alias:            "selected-source",
		CanonicalModelID: canonicalID,
		BillingClassID:   "sku:premium",
	})
	if err != nil {
		t.Fatalf("attach selected SKU: %v", err)
	}
	if result.Alias.BillingClassID != "sku:premium" || result.PriceResolution.Price == nil || result.PriceResolution.Price.Input != 3 {
		t.Fatalf("wrong target selected: %+v", result)
	}
}

func TestMergeCatalogDowngradesStaleInheritedPrice(t *testing.T) {
	setupPriceTestDB(t)
	stale := model.LLMInfo{
		Name:                  "stale-inherited",
		CanonicalModelID:      "product:removed",
		BillingClassID:        "sku:removed",
		PriceMode:             model.PriceInherited,
		PriceSource:           "user",
		PriceVersion:          "old",
		EffectivePrice:        &model.LLMPrice{Input: 9, Output: 10},
		EffectivePriceSource:  "user",
		EffectivePriceVersion: "old",
		ResolutionStatus:      model.BillingStatusResolved,
		ResolutionMethod:      "provider_alias",
		InheritedFrom:         "product:removed",
		LLMPrice:              model.LLMPrice{Input: 9, Output: 10},
	}

	merged := MergeCatalogLLMInfo([]model.LLMInfo{stale})
	got := merged[0]
	if got.PriceMode != model.PriceUnknown || !got.NeedsReview || got.EffectivePrice != nil {
		t.Fatalf("stale inherited price was not downgraded: %+v", got)
	}
	if got.Input != 0 || got.Output != 0 || got.PriceSource != "" || got.InheritedFrom != "" || got.ResolutionStatus != model.BillingStatusUnknown {
		t.Fatalf("stale inherited metadata leaked: %+v", got)
	}
}

func TestMergeCatalogRefreshesDirectInheritedPriceFromCurrentTarget(t *testing.T) {
	setupPriceTestDB(t)
	target := testCatalogEntry("fireworks", "direct-inherited-target", 5, 12)
	installTestCatalog(t, target)
	stored := model.LLMInfo{
		Name:             "direct-inherited-source",
		Provider:         "fireworks",
		CanonicalModelID: target.CanonicalModelID,
		BillingClassID:   target.BillingClassID,
		PriceMode:        model.PriceInherited,
		PriceSource:      "stale",
		LLMPrice:         model.LLMPrice{Input: 99, Output: 99},
	}

	merged := MergeCatalogLLMInfo([]model.LLMInfo{stored})
	got := merged[0]
	if got.PriceMode != model.PriceInherited || got.NeedsReview || got.EffectivePrice == nil {
		t.Fatalf("valid direct inherited target was downgraded: %+v", got)
	}
	if got.Input != target.Price.Input || got.Output != target.Price.Output || got.PriceSource != target.Source {
		t.Fatalf("direct inherited price was not refreshed: %+v", got)
	}
	if got.ResolutionMethod != "inherited_target" || got.InheritedFrom != target.CanonicalModelID {
		t.Fatalf("direct inherited identity is incomplete: %+v", got)
	}
}
