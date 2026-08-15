package openai

import (
	"context"
	"encoding/json"
	"io"
	"testing"

	inboundOpenAI "github.com/bestruirui/octopus/internal/transformer/inbound/openai"
	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestBuildChatCompletionsRequestUsesExplicitWhitelist(t *testing.T) {
	content := "hello"
	user := "legacy-user"
	safetyID := "safe-user"
	enableThinking := true

	req := &model.InternalLLMRequest{
		Model: "gpt-4o",
		Messages: []model.Message{{
			Role: "developer",
			Content: model.MessageContent{
				Content: &content,
			},
		}},
		User:                    &user,
		SafetyIdentifier:        &safetyID,
		EnableThinking:          &enableThinking,
		Metadata:                map[string]string{"trace_id": "abc123"},
		ResponsesPromptCacheKey: stringPtr("resp_cache_only"),
		Audio: &struct {
			Format string `json:"format,omitempty"`
			Voice  string `json:"voice,omitempty"`
		}{
			Format: "mp3",
			Voice:  "alloy",
		},
	}

	wire := buildChatCompletionsRequest(req)
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal chat request failed: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal chat request failed: %v", err)
	}

	if got := payload["model"]; got != "gpt-4o" {
		t.Fatalf("expected model to be preserved, got %#v", got)
	}
	if got := payload["safety_identifier"]; got != safetyID {
		t.Fatalf("expected safety_identifier to be preserved, got %#v", got)
	}
	if _, ok := payload["metadata"]; !ok {
		t.Fatalf("expected metadata to be preserved, got %#v", payload)
	}
	// O-H1: `user` is a legacy but still-accepted OpenAI field; forward it when
	// the client supplied one so downstreams keying on it keep working.
	if got := payload["user"]; got != user {
		t.Fatalf("expected legacy user to be forwarded, got %#v", got)
	}
	if _, ok := payload["enable_thinking"]; ok {
		t.Fatalf("expected provider-specific enable_thinking to be omitted, got %#v", payload["enable_thinking"])
	}
	if _, ok := payload["prompt_cache_key"]; ok {
		t.Fatalf("expected responses-only prompt_cache_key to be omitted, got %#v", payload["prompt_cache_key"])
	}

	audio, ok := payload["audio"].(map[string]any)
	if !ok || audio["format"] != "mp3" || audio["voice"] != "alloy" {
		t.Fatalf("expected audio settings to be preserved, got %#v", payload["audio"])
	}
}

// TestBuildChatCompletionsRequestForwardsPromptCacheKey verifies that a
// client-supplied prompt_cache_key on the Chat entrypoint reaches the
// upstream Chat Completions payload. Before O-C4, PromptCacheKey was a
// *bool that json.Unmarshal never populated from a string wire value, so
// the cache key was silently dropped — losing up to ~90% input-cost savings
// for any client that relied on prompt-cache bucketing.
func TestBuildChatCompletionsRequestForwardsPromptCacheKey(t *testing.T) {
	cacheKey := "session-abc-123"
	content := "hi"
	req := &model.InternalLLMRequest{
		Model: "gpt-4o",
		Messages: []model.Message{{
			Role:    "user",
			Content: model.MessageContent{Content: &content},
		}},
		PromptCacheKey: &cacheKey,
	}

	wire := buildChatCompletionsRequest(req)
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := payload["prompt_cache_key"]; got != cacheKey {
		t.Fatalf("expected prompt_cache_key=%q in chat payload, got %#v", cacheKey, got)
	}
}

func TestBuildChatCompletionsRequestDerivesAnthropicPromptCacheKey(t *testing.T) {
	first := anthropicCacheRequest("latest question")
	second := anthropicCacheRequest("different latest question")

	firstWire := buildChatCompletionsRequest(first)
	secondWire := buildChatCompletionsRequest(second)
	if firstWire.PromptCacheKey == nil || secondWire.PromptCacheKey == nil {
		t.Fatalf("expected derived chat prompt_cache_key, got %+v and %+v", firstWire.PromptCacheKey, secondWire.PromptCacheKey)
	}
	if *firstWire.PromptCacheKey != *secondWire.PromptCacheKey {
		t.Fatalf("expected latest user changes to keep stable chat cache key, got %q and %q", *firstWire.PromptCacheKey, *secondWire.PromptCacheKey)
	}
}

// O-H1: 2025 Chat fields (verbosity, prediction, web_search_options) must land
// on the outbound payload when the client supplied them. Before this fix the
// whitelist simply dropped them, so gpt-5 verbosity and predicted outputs were
// silently unavailable through the aggregator.
func TestBuildChatCompletionsRequestForwards2025Fields(t *testing.T) {
	content := "hello"
	verbosity := "high"
	req := &model.InternalLLMRequest{
		Model: "gpt-5",
		Messages: []model.Message{{
			Role:    "user",
			Content: model.MessageContent{Content: &content},
		}},
		Verbosity:        &verbosity,
		Prediction:       json.RawMessage(`{"type":"content","content":"code edit preview"}`),
		WebSearchOptions: json.RawMessage(`{"search_context_size":"low"}`),
	}

	wire := buildChatCompletionsRequest(req)
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got := payload["verbosity"]; got != "high" {
		t.Fatalf("expected verbosity=high, got %#v", got)
	}
	prediction, ok := payload["prediction"].(map[string]any)
	if !ok || prediction["type"] != "content" {
		t.Fatalf("expected prediction to be forwarded, got %#v", payload["prediction"])
	}
	search, ok := payload["web_search_options"].(map[string]any)
	if !ok || search["search_context_size"] != "low" {
		t.Fatalf("expected web_search_options to be forwarded, got %#v", payload["web_search_options"])
	}
}

// TestTransformRequestPreservesDeveloperRole verifies O-L5: the Chat
// outbound no longer downgrades `developer` messages to `system`.
// OpenAI 2025+ model spec treats developer as the canonical instruction
// role for reasoning models, and the API accepts it natively, so we
// forward the caller's original role to keep gpt-5-series behaviour
// correct.
func TestTransformRequestPreservesDeveloperRole(t *testing.T) {
	outbound := &ChatOutbound{}
	content := "you are terse"
	req := &model.InternalLLMRequest{
		Model: "gpt-5",
		Messages: []model.Message{
			{Role: "developer", Content: model.MessageContent{Content: &content}},
			{Role: "user", Content: model.MessageContent{Content: stringPtr("hi")}},
		},
	}
	httpReq, err := outbound.TransformRequest(context.Background(), req, "https://api.openai.com", "sk-test")
	if err != nil {
		t.Fatalf("TransformRequest: %v", err)
	}
	body, err := io.ReadAll(httpReq.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var payload struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(payload.Messages) < 1 {
		t.Fatalf("expected messages, got %+v", payload)
	}
	if role := payload.Messages[0]["role"]; role != "developer" {
		t.Errorf("expected first message role=developer, got %q", role)
	}
}

// TestResponsesInboundToChatOutboundPreservesParallelToolCallPairing covers
// the full Responses -> internal model -> Chat Completions conversion path.
// Consecutive function calls belong to one assistant turn; splitting them into
// separate assistant messages makes the first call appear unanswered when the
// next assistant message reaches a Chat Completions provider.
func TestResponsesInboundToChatOutboundPreservesParallelToolCallPairing(t *testing.T) {
	const responsesRequest = `{
		"model": "gpt-4o",
		"input": [
			{"type":"function_call","call_id":"run_code_1","name":"run_code","arguments":"{\"code\":\"first\"}"},
			{"type":"function_call","call_id":"run_code_2","name":"run_code","arguments":"{\"code\":\"second\"}"},
			{"type":"function_call_output","call_id":"run_code_1","output":"first result"},
			{"type":"function_call_output","call_id":"run_code_2","output":"second result"}
		]
	}`

	inbound := &inboundOpenAI.ResponseInbound{}
	internalReq, err := inbound.TransformRequest(context.Background(), []byte(responsesRequest))
	if err != nil {
		t.Fatalf("Responses inbound TransformRequest: %v", err)
	}
	if err := internalReq.Validate(); err != nil {
		t.Fatalf("validate transformed request: %v", err)
	}

	outbound := &ChatOutbound{}
	httpReq, err := outbound.TransformRequest(
		context.Background(),
		internalReq,
		"https://api.openai.com/v1",
		"sk-test",
	)
	if err != nil {
		t.Fatalf("Chat outbound TransformRequest: %v", err)
	}
	body, err := io.ReadAll(httpReq.Body)
	if err != nil {
		t.Fatalf("read outbound request body: %v", err)
	}

	var payload struct {
		Messages []struct {
			Role       string  `json:"role"`
			ToolCallID *string `json:"tool_call_id"`
			ToolCalls  []struct {
				ID       string `json:"id"`
				Index    int    `json:"index"`
				Type     string `json:"type"`
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal outbound request: %v", err)
	}

	if got, want := len(payload.Messages), 3; got != want {
		t.Fatalf("message count = %d, want %d; body=%s", got, want, body)
	}
	wantRoles := []string{"assistant", "tool", "tool"}
	for index, wantRole := range wantRoles {
		if got := payload.Messages[index].Role; got != wantRole {
			t.Fatalf("messages[%d].role = %q, want %q; body=%s", index, got, wantRole, body)
		}
	}

	assistantCalls := payload.Messages[0].ToolCalls
	if got, want := len(assistantCalls), 2; got != want {
		t.Fatalf("assistant tool_calls count = %d, want %d; body=%s", got, want, body)
	}
	wantCallIDs := []string{"run_code_1", "run_code_2"}
	for index, wantID := range wantCallIDs {
		call := assistantCalls[index]
		if call.ID != wantID {
			t.Errorf("tool_calls[%d].id = %q, want %q", index, call.ID, wantID)
		}
		if call.Index != index {
			t.Errorf("tool_calls[%d].index = %d, want dense index %d", index, call.Index, index)
		}
		if call.Type != "function" || call.Function.Name != "run_code" {
			t.Errorf("tool_calls[%d] function = %#v, want function run_code", index, call)
		}

		toolMessage := payload.Messages[index+1]
		if toolMessage.ToolCallID == nil {
			t.Errorf("messages[%d].tool_call_id is nil, want %q", index+1, wantID)
		} else if *toolMessage.ToolCallID != wantID {
			t.Errorf("messages[%d].tool_call_id = %q, want %q", index+1, *toolMessage.ToolCallID, wantID)
		}
	}
}

// Chat outbound forwards OpenAI-Organization / OpenAI-Project when they
// are present in TransformerMetadata, and skips them cleanly when absent
// or blank.
func TestBuildChatCompletionsRequestDropsImageGenerationTools(t *testing.T) {
	content := "hello"
	req := &model.InternalLLMRequest{
		Model: "gpt-4o",
		Messages: []model.Message{{
			Role:    "user",
			Content: model.MessageContent{Content: &content},
		}},
		Tools: []model.Tool{
			{Type: "function", Function: model.Function{Name: "lookup", Parameters: json.RawMessage(`{"type":"object"}`)}},
			{Type: "image_generation", ImageGeneration: &model.ImageGeneration{Background: "transparent"}},
		},
	}

	wire := buildChatCompletionsRequest(req)
	body, err := json.Marshal(wire)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	tools, ok := payload["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected only function tool in chat payload, got %#v", payload["tools"])
	}
	tool, ok := tools[0].(map[string]any)
	if !ok || tool["type"] != "function" {
		t.Fatalf("expected function tool in chat payload, got %#v", tools[0])
	}
}

func TestTransformRequestAttachesOrgAndProjectHeaders(t *testing.T) {
	outbound := &ChatOutbound{}
	content := "hi"
	req := &model.InternalLLMRequest{
		Model: "gpt-5",
		Messages: []model.Message{
			{Role: "user", Content: model.MessageContent{Content: &content}},
		},
	}
	req.SetTransformerMetadataValue(model.TransformerMetadataOpenAIOrganization, "org-abc")
	req.SetTransformerMetadataValue(model.TransformerMetadataOpenAIProject, "proj-xyz")
	httpReq, err := outbound.TransformRequest(context.Background(), req, "https://api.openai.com", "sk-test")
	if err != nil {
		t.Fatalf("TransformRequest: %v", err)
	}
	if got := httpReq.Header.Get("OpenAI-Organization"); got != "org-abc" {
		t.Errorf("OpenAI-Organization: got %q, want %q", got, "org-abc")
	}
	if got := httpReq.Header.Get("OpenAI-Project"); got != "proj-xyz" {
		t.Errorf("OpenAI-Project: got %q, want %q", got, "proj-xyz")
	}

	// Whitespace-only values are skipped so the header is not sent blank.
	req.SetTransformerMetadataValue(model.TransformerMetadataOpenAIOrganization, "   ")
	httpReq, err = outbound.TransformRequest(context.Background(), req, "https://api.openai.com", "sk-test")
	if err != nil {
		t.Fatalf("TransformRequest blank: %v", err)
	}
	if got := httpReq.Header.Get("OpenAI-Organization"); got != "" {
		t.Errorf("expected OpenAI-Organization omitted for blank value, got %q", got)
	}
}
