package price

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
)

func setupPriceTestDB(t *testing.T) context.Context {
	t.Helper()
	if db.GetDB() != nil {
		_ = db.Close()
	}
	if err := db.InitDB("sqlite", filepath.Join(t.TempDir(), "price-test.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if err := op.InitCache(); err != nil {
		t.Fatalf("InitCache failed: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return context.Background()
}

func installTestCatalog(t *testing.T, entries ...catalogEntry) {
	t.Helper()
	llmPriceLock.Lock()
	old := remoteCatalog
	next := make(map[string]catalogEntry, len(entries))
	for _, entry := range entries {
		next[entry.CanonicalModelID] = entry
	}
	remoteCatalog = next
	llmPriceLock.Unlock()
	t.Cleanup(func() {
		llmPriceLock.Lock()
		remoteCatalog = old
		llmPriceLock.Unlock()
	})
}

func testCatalogEntry(provider, modelID string, input, output float64) catalogEntry {
	return newCatalogEntry(provider, modelID, model.LLMPrice{Input: input, Output: output}, "remote", "test-v1")
}

func TestResolveModelIdentitySafeVariants(t *testing.T) {
	setupPriceTestDB(t)
	base := testCatalogEntry("openai", "oct-test-base", 1, 2)
	mini := testCatalogEntry("openai", "oct-test-base-mini", 3, 4)
	installTestCatalog(t, base, mini)

	tests := []struct {
		name      string
		ctx       model.ModelResolveContext
		status    string
		method    string
		canonical string
	}{
		{
			name:   "canonical exact is case and whitespace insensitive",
			ctx:    model.ModelResolveContext{RawModel: "  OCT-Test-Base  ", Provider: "openai"},
			status: model.BillingStatusResolved, method: "exact", canonical: base.CanonicalModelID,
		},
		{
			name:   "provider prefix",
			ctx:    model.ModelResolveContext{RawModel: "openai/oct-test-base", Provider: "openai"},
			status: model.BillingStatusResolved, method: "provider_prefix", canonical: base.CanonicalModelID,
		},
		{
			name:   "configured channel wrapper",
			ctx:    model.ModelResolveContext{RawModel: "~openai/oct-test-base", Provider: "openai", ChannelID: 17, AllowedWrapperPrefixes: []string{"~"}},
			status: model.BillingStatusResolved, method: "channel_wrapper", canonical: base.CanonicalModelID,
		},
		{
			name:   "longest canonical snapshot prefix",
			ctx:    model.ModelResolveContext{RawModel: "oct-test-base-mini-2026-03-17", Provider: "openai"},
			status: model.BillingStatusResolved, method: "snapshot", canonical: mini.CanonicalModelID,
		},
		{
			name:   "semantic suffix is not removed",
			ctx:    model.ModelResolveContext{RawModel: "oct-test-base-thinking", Provider: "openai"},
			status: model.BillingStatusUnknown, method: "unknown",
		},
		{
			name:   "unconfigured punctuation wrapper is not removed",
			ctx:    model.ModelResolveContext{RawModel: "!!openai/oct-test-base", Provider: "openai", ChannelID: 17},
			status: model.BillingStatusUnknown, method: "unknown",
		},
		{
			name:   "provider mismatch blocks prefix removal",
			ctx:    model.ModelResolveContext{RawModel: "openai/oct-test-base", Provider: "anthropic"},
			status: model.BillingStatusUnknown, method: "unknown",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveModelIdentity(tc.ctx)
			if got.Status != tc.status || got.Method != tc.method || got.CanonicalModelID != tc.canonical {
				t.Fatalf("unexpected resolution: %+v", got)
			}
		})
	}
}

func TestResolveModelIdentityConflict(t *testing.T) {
	setupPriceTestDB(t)
	openAI := testCatalogEntry("openai", "oct-conflict", 1, 2)
	anthropic := testCatalogEntry("anthropic", "oct-conflict", 3, 4)
	installTestCatalog(t, openAI, anthropic)

	got := ResolveModelIdentity(model.ModelResolveContext{RawModel: "oct-conflict"})
	if got.Status != model.BillingStatusConflict || got.Method != "conflict" {
		t.Fatalf("expected conflict, got %+v", got)
	}
}

func TestModelAliasScopePrecedenceAndIsolation(t *testing.T) {
	ctx := setupPriceTestDB(t)
	globalEntry := testCatalogEntry("openai", "oct-global", 1, 2)
	channelEntry := testCatalogEntry("anthropic", "oct-channel", 3, 4)
	installTestCatalog(t, globalEntry, channelEntry)

	globalAlias := model.ModelAlias{Alias: "oct-alias", CanonicalModelID: globalEntry.CanonicalModelID, Enabled: true}
	if err := op.ModelAliasCreate(&globalAlias, ctx); err != nil {
		t.Fatalf("create global alias: %v", err)
	}
	channelID := 17
	channelAlias := model.ModelAlias{ChannelID: &channelID, Alias: "oct-alias", CanonicalModelID: channelEntry.CanonicalModelID, Enabled: true}
	if err := op.ModelAliasCreate(&channelAlias, ctx); err != nil {
		t.Fatalf("create channel alias: %v", err)
	}

	channelResolution := ResolveModelIdentity(model.ModelResolveContext{RawModel: "oct-alias", ChannelID: 17})
	if channelResolution.Method != "channel_alias" || channelResolution.CanonicalModelID != channelEntry.CanonicalModelID {
		t.Fatalf("unexpected channel alias resolution: %+v", channelResolution)
	}
	otherResolution := ResolveModelIdentity(model.ModelResolveContext{RawModel: "oct-alias", ChannelID: 18})
	if otherResolution.Method != "alias" || otherResolution.CanonicalModelID != globalEntry.CanonicalModelID {
		t.Fatalf("channel alias leaked to another channel: %+v", otherResolution)
	}
}

func TestPriceResolutionPriorityUnknownAndFree(t *testing.T) {
	ctx := setupPriceTestDB(t)
	entry := testCatalogEntry("openai", "oct-price", 1, 2)
	installTestCatalog(t, entry)

	unknown := model.LLMInfo{
		Name:             "oct-price",
		Provider:         "openai",
		CanonicalModelID: entry.CanonicalModelID,
		BillingClassID:   entry.BillingClassID,
		PriceMode:        model.PriceUnknown,
		AutoDiscovered:   true,
	}
	if err := op.LLMBatchCreate([]model.LLMInfo{unknown}, ctx); err != nil {
		t.Fatalf("create unknown row: %v", err)
	}
	resolution := ResolveModelIdentity(model.ModelResolveContext{RawModel: "oct-price", Provider: "openai"})
	catalogPrice := ResolvePrice(resolution)
	if catalogPrice.PriceSource != "remote" || catalogPrice.Price == nil || catalogPrice.Price.Input != 1 {
		t.Fatalf("unknown zero row shadowed catalog price: %+v", catalogPrice)
	}

	user := model.LLMInfo{
		Name:             "oct-price-user",
		Provider:         "openai",
		CanonicalModelID: entry.CanonicalModelID,
		BillingClassID:   entry.BillingClassID,
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 9, Output: 10},
	}
	if err := op.LLMCreate(user, ctx); err != nil {
		t.Fatalf("create user price: %v", err)
	}
	userPrice := ResolvePrice(resolution)
	if userPrice.PriceSource != "user" || userPrice.Price == nil || userPrice.Price.Input != 9 {
		t.Fatalf("user price did not override catalog: %+v", userPrice)
	}

	free := model.LLMInfo{
		Name:             "oct-free",
		CanonicalModelID: "product:oct-free",
		BillingClassID:   "product:oct-free",
		PriceMode:        model.PriceFree,
	}
	if err := op.LLMCreate(free, ctx); err != nil {
		t.Fatalf("create free price: %v", err)
	}
	freePrice := ResolvePriceByBillingClassID("product:oct-free")
	if freePrice.Status != model.BillingStatusFree || freePrice.PriceMode != model.PriceFree {
		t.Fatalf("explicit free was not preserved: %+v", freePrice)
	}
}

func TestAliasIndependentPriceOverridesInheritance(t *testing.T) {
	ctx := setupPriceTestDB(t)
	entry := testCatalogEntry("anthropic", "claude-fable-5", 10, 50)
	installTestCatalog(t, entry)

	alias := model.ModelAlias{
		Alias:            "~anthropic/claude-fable-5",
		CanonicalModelID: entry.CanonicalModelID,
		BillingClassID:   "product:fable-premium",
		Enabled:          true,
	}
	if err := op.ModelAliasCreate(&alias, ctx); err != nil {
		t.Fatalf("create alias: %v", err)
	}
	override := model.LLMInfo{
		Name:             "product:fable-premium",
		CanonicalModelID: "product:fable-premium",
		BillingClassID:   "product:fable-premium",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 20, Output: 80},
	}
	if err := op.LLMCreate(override, ctx); err != nil {
		t.Fatalf("create alias override price: %v", err)
	}

	resolution := ResolveModelIdentity(model.ModelResolveContext{RawModel: alias.Alias, Provider: "anthropic"})
	resolvedPrice := ResolvePrice(resolution)
	if resolution.Method != "alias" || resolvedPrice.PriceSource != "user" || resolvedPrice.Price == nil || resolvedPrice.Price.Input != 20 {
		t.Fatalf("alias override not applied: resolution=%+v price=%+v", resolution, resolvedPrice)
	}
}

func TestClaudeFableResolutionAudit(t *testing.T) {
	setupPriceTestDB(t)
	entry := newCatalogEntry("anthropic", "claude-fable-5", model.LLMPrice{
		Input:      10,
		CacheRead:  1,
		Output:     50,
		CacheWrite: 12.5,
	}, "remote", "models.dev-test")
	installTestCatalog(t, entry)

	cases := []model.ModelResolveContext{
		{RawModel: "claude-fable-5", Provider: "anthropic", ChannelID: 17},
		{RawModel: "anthropic/claude-fable-5", Provider: "anthropic", ChannelID: 17},
		{RawModel: "~anthropic/claude-fable-5", Provider: "anthropic", ChannelID: 17, AllowedWrapperPrefixes: []string{"~"}},
	}
	for _, resolveCtx := range cases {
		resolution := ResolveModelIdentity(resolveCtx)
		resolvedPrice := ResolvePrice(resolution)
		t.Logf("raw=%q method=%s canonical=%s billing_class=%s source=%s mode=%s price=%+v",
			resolveCtx.RawModel, resolution.Method, resolution.CanonicalModelID, resolution.BillingClassID,
			resolvedPrice.PriceSource, resolvedPrice.PriceMode, resolvedPrice.Price)
		if resolution.Status != model.BillingStatusResolved || resolution.CanonicalModelID != entry.CanonicalModelID || resolution.BillingClassID != entry.BillingClassID {
			t.Fatalf("unexpected resolution for %q: %+v", resolveCtx.RawModel, resolution)
		}
		if resolvedPrice.Price == nil || *resolvedPrice.Price != entry.Price {
			t.Fatalf("unexpected effective price for %q: %+v", resolveCtx.RawModel, resolvedPrice)
		}
	}
}

func TestCatalogListAndStoredOverrideMerge(t *testing.T) {
	setupPriceTestDB(t)
	entry := testCatalogEntry("openai", "oct-catalog-visible", 1.25, 2.5)
	installTestCatalog(t, entry)

	catalog := ListCatalogLLMInfo()
	found := false
	for _, info := range catalog {
		if info.CanonicalModelID != entry.CanonicalModelID {
			continue
		}
		found = true
		if !info.CatalogOnly || info.PriceSource != "remote" || info.Input != 1.25 {
			t.Fatalf("unexpected catalog row: %+v", info)
		}
	}
	if !found {
		t.Fatalf("catalog row was not exposed")
	}

	stored := model.LLMInfo{
		Name:             entry.ModelID,
		CanonicalModelID: entry.CanonicalModelID,
		BillingClassID:   entry.BillingClassID,
		PriceMode:        model.PriceExplicit,
		PriceSource:      "user",
		LLMPrice:         model.LLMPrice{Input: 9, Output: 10},
	}
	merged := MergeCatalogLLMInfo([]model.LLMInfo{stored})
	matching := 0
	for _, info := range merged {
		if info.Name != entry.ModelID {
			continue
		}
		matching++
		if info.CatalogOnly || info.PriceSource != "user" || info.Input != 9 {
			t.Fatalf("stored override did not win: %+v", info)
		}
	}
	if matching != 1 {
		t.Fatalf("expected exactly one merged row for %q, got %d", entry.ModelID, matching)
	}
}
