package op

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	dbpkg "github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
)

func setupModelAliasTestDB(t *testing.T) context.Context {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "model-alias-test.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if err := InitCache(); err != nil {
		t.Fatalf("InitCache failed: %v", err)
	}
	t.Cleanup(func() { _ = dbpkg.Close() })
	return context.Background()
}

func TestModelAliasAttachRejectsExplicitSourceForEveryConflictPolicy(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	if err := LLMCreate(model.LLMInfo{
		Name:             "priced-source",
		CanonicalModelID: "product:source",
		BillingClassID:   "product:source",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 1, Output: 2},
	}, ctx); err != nil {
		t.Fatalf("create source price: %v", err)
	}

	for _, policy := range []string{model.ModelAliasConflictReject, model.ModelAliasConflictReplace} {
		alias := model.ModelAlias{
			Alias:            "priced-source",
			CanonicalModelID: "product:target",
			BillingClassID:   "product:target",
		}
		if err := ModelAliasAttach(&alias, policy, ctx); !errors.Is(err, ErrModelAliasSourcePriceConflict) {
			t.Fatalf("policy %q: expected source price conflict, got %v", policy, err)
		}
	}
	if _, _, ok := ModelAliasResolve(0, "", "priced-source"); ok {
		t.Fatal("rejected attachment leaked into alias cache")
	}
}

func TestModelAliasAttachConflictAndReplaceKeepDBAndCacheConsistent(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	original := model.ModelAlias{
		Alias:            "observed-model",
		CanonicalModelID: "product:first",
		BillingClassID:   "product:first",
		Enabled:          true,
	}
	if err := ModelAliasCreate(&original, ctx); err != nil {
		t.Fatalf("create original alias: %v", err)
	}

	replacement := model.ModelAlias{
		Alias:            original.Alias,
		CanonicalModelID: "product:second",
		BillingClassID:   "product:second",
	}
	if err := ModelAliasAttach(&replacement, model.ModelAliasConflictReject, ctx); !errors.Is(err, ErrModelAliasConflict) {
		t.Fatalf("expected alias conflict, got %v", err)
	}
	resolved, _, ok := ModelAliasResolve(0, "", original.Alias)
	if !ok || resolved.CanonicalModelID != original.CanonicalModelID {
		t.Fatalf("rejected replacement changed cache: %+v", resolved)
	}

	if err := ModelAliasAttach(&replacement, model.ModelAliasConflictReplace, ctx); err != nil {
		t.Fatalf("replace alias: %v", err)
	}
	if replacement.ID != original.ID {
		t.Fatalf("replacement created a new row: got id %d want %d", replacement.ID, original.ID)
	}
	resolved, _, ok = ModelAliasResolve(0, "", original.Alias)
	if !ok || resolved.CanonicalModelID != replacement.CanonicalModelID {
		t.Fatalf("replacement did not refresh cache: %+v", resolved)
	}
	var count int64
	if err := dbpkg.GetDB().Model(&model.ModelAlias{}).Where("alias = ?", original.Alias).Count(&count).Error; err != nil {
		t.Fatalf("count aliases: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one persisted alias, got %d", count)
	}
}

func TestModelAliasConcurrentAttachKeepsDatabaseAndCacheEqual(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	const workers = 32
	start := make(chan struct{})
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			target := "product:even"
			if index%2 == 1 {
				target = "product:odd"
			}
			alias := model.ModelAlias{
				Alias:            "concurrent-source",
				CanonicalModelID: target,
				BillingClassID:   target,
			}
			errs <- ModelAliasAttach(&alias, model.ModelAliasConflictReplace, ctx)
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent attach failed: %v", err)
		}
	}

	var persisted model.ModelAlias
	if err := dbpkg.GetDB().Where("scope_key = ? AND alias = ?", "global", "concurrent-source").Take(&persisted).Error; err != nil {
		t.Fatalf("load persisted alias: %v", err)
	}
	cached, _, ok := ModelAliasResolve(0, "", "concurrent-source")
	if !ok {
		t.Fatal("concurrent alias missing from cache")
	}
	if cached.ID != persisted.ID || cached.CanonicalModelID != persisted.CanonicalModelID || cached.BillingClassID != persisted.BillingClassID {
		t.Fatalf("database/cache diverged: db=%+v cache=%+v", persisted, cached)
	}
}
