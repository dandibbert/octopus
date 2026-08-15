package op

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func TestLLMUpdateRemovesObsoleteBillingClassCacheKeys(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	info := model.LLMInfo{
		Name:             "billing-cache-model",
		CanonicalModelID: "product:billing-cache-model",
		BillingClassID:   "sku:old",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 1, Output: 2},
	}
	if err := LLMCreate(info, ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}

	info.BillingClassID = "sku:new"
	if err := LLMUpdate(info, ctx); err != nil {
		t.Fatalf("rename billing class: %v", err)
	}
	if _, err := LLMGetByBillingClassID("sku:old"); err == nil {
		t.Fatal("old billing class remained cached after rename")
	}
	if got, err := LLMGetByBillingClassID("sku:new"); err != nil || got.Name != info.Name {
		t.Fatalf("new billing class missing from cache: got=%+v err=%v", got, err)
	}

	info.PriceMode = model.PriceUnknown
	info.LLMPrice = model.LLMPrice{}
	if err := LLMUpdate(info, ctx); err != nil {
		t.Fatalf("mark price unknown: %v", err)
	}
	if _, err := LLMGetByBillingClassID("sku:new"); err == nil {
		t.Fatal("billing class remained cached after price became unknown")
	}
}
