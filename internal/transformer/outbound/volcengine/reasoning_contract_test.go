package volcengine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestTransformRequestRejectsUnsupportedReasoningIntent(t *testing.T) {
	tests := []struct {
		name   string
		model  string
		effort string
	}{
		{name: "unsupported model", model: "doubao-unknown", effort: "high"},
		{name: "unsupported xhigh", model: "doubao-seed-1-8-251228", effort: "xhigh"},
		{name: "unknown effort", model: "doubao-seed-1-8-251228", effort: "bogus"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := &ResponseOutbound{}
			_, err := o.TransformRequest(context.Background(), &model.InternalLLMRequest{
				Model:           tt.model,
				ReasoningEffort: tt.effort,
			}, "https://ark.cn-beijing.volces.com/api/v3", "test-key")
			if err == nil || !strings.Contains(err.Error(), "reasoning_effort="+tt.effort) {
				t.Fatalf("expected explicit unsupported-parameter error, got %v", err)
			}
		})
	}
}

func TestTransformRequestNoneDisablesThinking(t *testing.T) {
	o := &ResponseOutbound{}
	content := "hello"
	req, err := o.TransformRequest(context.Background(), &model.InternalLLMRequest{
		Model:           "doubao-seed-1-8-251228",
		ReasoningEffort: "none",
		Messages: []model.Message{{
			Role:    "user",
			Content: model.MessageContent{Content: &content},
		}},
	}, "https://ark.cn-beijing.volces.com/api/v3", "test-key")
	if err != nil {
		t.Fatalf("TransformRequest: %v", err)
	}
	var body map[string]any
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	thinking, ok := body["thinking"].(map[string]any)
	if !ok || thinking["type"] != string(ThinkingTypeDisabled) {
		t.Fatalf("reasoning_effort=none must disable thinking, got %#v", body["thinking"])
	}
	if _, ok := body["reasoning"]; ok {
		t.Fatalf("disabled thinking must not forward unsupported reasoning effort: %#v", body["reasoning"])
	}
}
