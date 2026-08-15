package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	dbpkg "github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/price"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/gin-gonic/gin"
)

func setupModelAliasHandlerTestDB(t *testing.T) context.Context {
	t.Helper()
	if dbpkg.GetDB() != nil {
		_ = dbpkg.Close()
	}
	if err := dbpkg.InitDB("sqlite", filepath.Join(t.TempDir(), "model-alias-handler-test.db"), false); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if err := op.InitCache(); err != nil {
		t.Fatalf("InitCache failed: %v", err)
	}
	t.Cleanup(func() { _ = dbpkg.Close() })
	return context.Background()
}

func callAttachModelAlias(t *testing.T, body any) (int, resp.ResponseStruct) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/model/alias/attach", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	attachModelAlias(c)
	var response resp.ResponseStruct
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
	return recorder.Code, response
}

func TestAttachModelAliasHandlerReturnsFinalResolution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := setupModelAliasHandlerTestDB(t)
	if err := op.LLMCreate(model.LLMInfo{
		Name:             "priced-target",
		Provider:         "fireworks",
		CanonicalModelID: "fireworks:accounts/fireworks/models/kimi-k3",
		BillingClassID:   "product:kimi-k3",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 1, Output: 3},
	}, ctx); err != nil {
		t.Fatalf("create target price: %v", err)
	}

	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "accounts/fireworks/models/kimi-k3",
		CanonicalModelID: "fireworks:accounts/fireworks/models/kimi-k3",
		BillingClassID:   "product:kimi-k3",
		Provider:         "fireworks",
	})
	if status != http.StatusOK || response.Code != http.StatusOK {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
	encoded, err := json.Marshal(response.Data)
	if err != nil {
		t.Fatalf("marshal response data: %v", err)
	}
	var result model.ModelAliasAttachResponse
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatalf("decode response data: %v", err)
	}
	if result.Alias.ID == 0 || result.ModelResolution.Method != "provider_alias" {
		t.Fatalf("unexpected final alias resolution: %+v", result)
	}
	if result.PriceResolution.Status != model.BillingStatusResolved || result.PriceResolution.Price == nil {
		t.Fatalf("unexpected final price resolution: %+v", result.PriceResolution)
	}
}

func TestAttachModelAliasHandlerRejectsUnknownTargetWithoutPersisting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupModelAliasHandlerTestDB(t)

	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "unpriced-source",
		CanonicalModelID: "product:missing",
	})
	if status != http.StatusBadRequest || response.ErrorCode != price.ModelAliasAttachCodeTargetPriceUnknown {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
	if _, _, ok := op.ModelAliasResolve(0, "", "unpriced-source"); ok {
		t.Fatal("unknown target attachment was persisted")
	}
}

func TestAttachModelAliasHandlerRejectsDanglingCanonicalWithKnownBillingClass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := setupModelAliasHandlerTestDB(t)
	if err := op.LLMCreate(model.LLMInfo{
		Name:             "priced-target",
		CanonicalModelID: "product:real-target",
		BillingClassID:   "product:known-price",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 2, Output: 4},
	}, ctx); err != nil {
		t.Fatalf("create target price: %v", err)
	}

	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "unpriced-source",
		CanonicalModelID: "product:dangling-target",
		BillingClassID:   "product:known-price",
	})
	if status != http.StatusBadRequest || response.ErrorCode != price.ModelAliasAttachCodeTargetPriceUnknown {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
	if _, _, ok := op.ModelAliasResolve(0, "", "unpriced-source"); ok {
		t.Fatal("dangling canonical attachment was persisted")
	}
}

func TestAttachModelAliasHandlerReturnsStableSourcePriceConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := setupModelAliasHandlerTestDB(t)
	for _, info := range []model.LLMInfo{
		{
			Name:             "priced-source",
			CanonicalModelID: "product:source",
			BillingClassID:   "product:source",
			PriceMode:        model.PriceFree,
		},
		{
			Name:             "priced-target",
			CanonicalModelID: "product:target",
			BillingClassID:   "product:target",
			PriceMode:        model.PriceExplicit,
			LLMPrice:         model.LLMPrice{Input: 2, Output: 4},
		},
	} {
		if err := op.LLMCreate(info, ctx); err != nil {
			t.Fatalf("create model %q: %v", info.Name, err)
		}
	}

	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "priced-source",
		CanonicalModelID: "product:target",
		BillingClassID:   "product:target",
		ConflictPolicy:   model.ModelAliasConflictReplace,
	})
	if status != http.StatusConflict || response.ErrorCode != price.ModelAliasAttachCodeSourcePriceConflict {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
}

func TestAttachModelAliasHandlerRejectsMissingChannel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := setupModelAliasHandlerTestDB(t)
	if err := op.LLMCreate(model.LLMInfo{
		Name:             "priced-target",
		CanonicalModelID: "product:target",
		BillingClassID:   "product:target",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 2, Output: 4},
	}, ctx); err != nil {
		t.Fatalf("create target price: %v", err)
	}
	missingChannelID := 999999
	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "unpriced-source",
		CanonicalModelID: "product:target",
		BillingClassID:   "product:target",
		ChannelID:        &missingChannelID,
	})
	if status != http.StatusBadRequest || response.ErrorCode != price.ModelAliasAttachCodeInvalidRequest {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
}

func TestAttachModelAliasHandlerDoesNotLeakDatabaseErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := setupModelAliasHandlerTestDB(t)
	if err := op.LLMCreate(model.LLMInfo{
		Name:             "priced-target",
		CanonicalModelID: "product:target",
		BillingClassID:   "product:target",
		PriceMode:        model.PriceExplicit,
		LLMPrice:         model.LLMPrice{Input: 2, Output: 4},
	}, ctx); err != nil {
		t.Fatalf("create target price: %v", err)
	}
	if err := dbpkg.Close(); err != nil {
		t.Fatalf("close database: %v", err)
	}

	status, response := callAttachModelAlias(t, model.ModelAliasAttachRequest{
		Alias:            "unpriced-source",
		CanonicalModelID: "product:target",
		BillingClassID:   "product:target",
	})
	if status != http.StatusInternalServerError || response.Message != resp.ErrInternalServer {
		t.Fatalf("unexpected response: status=%d body=%+v", status, response)
	}
	if response.ErrorCode == "" {
		t.Fatal("internal error response is missing stable error code")
	}
}
