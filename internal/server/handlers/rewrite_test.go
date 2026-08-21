package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/rewrite"
	"github.com/bestruirui/octopus/internal/server/resp"
	transformerModel "github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/gin-gonic/gin"
)

func TestValidateRewriteAcceptsLegacyAndV2(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name string
		body any
	}{
		{name: "empty object", body: map[string]any{"scope": "channel", "config": map[string]any{}}},
		{name: "legacy", body: map[string]any{"scope": "channel", "config": map[string]any{"temperature": 0.2}}},
		{name: "v2", body: map[string]any{"scope": "group", "config": map[string]any{
			"$schema": "octopus.request-rewrite/v2",
			"stage":   "outbound_provider",
			"operations": []map[string]any{{
				"id":    "set-temp",
				"op":    "set",
				"path":  "/temperature",
				"value": 0.1,
			}},
		}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload, err := json.Marshal(tc.body)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/rewrite/validate", bytes.NewReader(payload))
			c.Request.Header.Set("Content-Type", "application/json")
			validateRewrite(c)
			if recorder.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			var response resp.ResponseStruct
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode: %v", err)
			}
			data, _ := response.Data.(map[string]any)
			if data["ok"] != true {
				t.Fatalf("expected ok=true, got %#v", response.Data)
			}
		})
	}
}

func TestValidateRewriteRejectsUnknownSchema(t *testing.T) {
	gin.SetMode(gin.TestMode)
	payload, _ := json.Marshal(map[string]any{
		"scope": "channel",
		"config": map[string]any{
			"$schema":    "not-a-schema",
			"stage":      "outbound_provider",
			"operations": []any{},
		},
	})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/rewrite/validate", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	validateRewrite(c)
	if recorder.Code == http.StatusOK {
		t.Fatalf("expected rejection, got %s", recorder.Body.String())
	}
}

func TestPreviewSentinelIsNotOpenAIKeyShape(t *testing.T) {
	if strings.HasPrefix(previewSentinelKey, "sk-") {
		t.Fatalf("preview sentinel looks like a real key: %q", previewSentinelKey)
	}
}

type stubOutbound struct{}

func (stubOutbound) TransformRequest(_ context.Context, request *transformerModel.InternalLLMRequest, _, _ string) (*http.Request, error) {
	body := fmt.Sprintf(`{"model":%q,"temperature":1}`, request.Model)
	req, err := http.NewRequest(http.MethodPost, "https://example.invalid/v1/chat/completions", strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+previewSentinelKey)
	return req, nil
}

func (stubOutbound) TransformResponse(context.Context, *http.Response) (*transformerModel.InternalLLMResponse, error) {
	return nil, nil
}

func (stubOutbound) TransformStream(context.Context, []byte) (*transformerModel.InternalLLMResponse, error) {
	return nil, nil
}

func TestPreviewOutboundAppliesCustomHeaderRewriteAndInvariants(t *testing.T) {
	draft := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"t","op":"set","path":"/temperature","value":0.2},
			{"id":"h","op":"header_set","header":"X-Rewrite","value":"yes"}
		]
	}`
	channel := &model.Channel{
		ID:    7,
		Name:  "preview-channel",
		Type:  outbound.OutboundTypeOpenAIChat,
		Model: "gpt-4o",
		CustomHeader: []model.CustomHeader{
			{HeaderKey: "X-Custom", HeaderValue: "from-channel"},
		},
	}
	result, err := previewOutbound(context.Background(), previewOutboundInput{
		Request: rewritePreviewRequest{
			ChannelID:     7,
			InboundFormat: "openai_chat",
			DraftScope:    rewrite.ScopeChannel,
			DraftConfig:   json.RawMessage(draft),
			Headers:       map[string]string{"X-Custom": "from-client"},
		},
		Channel:     channel,
		InboundRaw:  []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`),
		InternalReq: &transformerModel.InternalLLMRequest{Model: "gpt-4o"},
		OutAdapter:  stubOutbound{},
	})
	if err != nil {
		t.Fatal(err)
	}
	stages, _ := result["stages"].(gin.H)
	finalBody := string(stages["final_body"].(json.RawMessage))
	if !strings.Contains(finalBody, "0.2") {
		t.Fatalf("preview body missing rewrite: %s", finalBody)
	}
	headers, _ := stages["final_headers"].(map[string]string)
	if headers["X-Custom"] != "from-channel" {
		t.Fatalf("custom header missing: %#v", headers)
	}
	if headers["X-Rewrite"] != "yes" {
		t.Fatalf("rewrite header missing: %#v", headers)
	}
	if headers["Authorization"] != "***" {
		t.Fatalf("authorization not redacted: %#v", headers)
	}
	if _, ok := headers["Connection"]; ok {
		t.Fatalf("hop header leaked: %#v", headers)
	}
	if headers["Content-Type"] != "application/json" {
		t.Fatalf("content-type=%q", headers["Content-Type"])
	}
}

func TestPreviewOutboundUsesGroupRoutedModel(t *testing.T) {
	channel := &model.Channel{ID: 9, Name: "preview-route", Type: outbound.OutboundTypeOpenAIChat, Model: "remote-model"}
	group := &model.Group{ID: 3, Name: "alias-model", Items: []model.GroupItem{{ChannelID: 9, ModelName: "remote-model"}}}
	result, err := previewOutbound(context.Background(), previewOutboundInput{
		Request:     rewritePreviewRequest{ChannelID: 9, GroupID: 3, InboundFormat: "openai_chat"},
		Channel:     channel,
		Group:       group,
		ApplyGroup:  true,
		InboundRaw:  []byte(`{"model":"alias-model","messages":[{"role":"user","content":"hi"}]}`),
		InternalReq: &transformerModel.InternalLLMRequest{Model: "alias-model"},
		OutAdapter:  stubOutbound{},
	})
	if err != nil {
		t.Fatal(err)
	}
	stages := result["stages"].(gin.H)
	before := string(stages["outbound_before_rewrite"].(json.RawMessage))
	if !strings.Contains(before, `"model":"remote-model"`) {
		t.Fatalf("preview did not use routed model: %s", before)
	}
}

func TestPreviewOutboundAppliesUnsavedGroupDraftWithoutGroupID(t *testing.T) {
	draft := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"group-draft","op":"set","path":"/temperature","value":0.4}]
	}`
	channel := &model.Channel{ID: 8, Name: "preview-new-group-channel", Type: outbound.OutboundTypeOpenAIChat, Model: "gpt-4o"}
	result, err := previewOutbound(context.Background(), previewOutboundInput{
		Request: rewritePreviewRequest{
			ChannelID:     channel.ID,
			InboundFormat: "openai_chat",
			DraftScope:    rewrite.ScopeGroup,
			DraftConfig:   json.RawMessage(draft),
		},
		Channel:     channel,
		ApplyGroup:  true,
		InboundRaw:  []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`),
		InternalReq: &transformerModel.InternalLLMRequest{Model: "gpt-4o"},
		OutAdapter:  stubOutbound{},
	})
	if err != nil {
		t.Fatal(err)
	}
	stages := result["stages"].(gin.H)
	finalBody := string(stages["final_body"].(json.RawMessage))
	if !strings.Contains(finalBody, "0.4") {
		t.Fatalf("unsaved group draft was not applied: %s", finalBody)
	}
}
