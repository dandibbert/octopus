package gemini

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
		{name: "non-thinking model", model: "gemini-2.5-flash-lite", effort: "high"},
		{name: "cannot disable pro 2.5", model: "gemini-2.5-pro", effort: "none"},
		{name: "cannot disable gemini 3", model: "gemini-3.0-flash", effort: "none"},
		{name: "unsupported medium tier", model: "gemini-3.0-pro", effort: "medium"},
		{name: "unknown effort", model: "gemini-2.5-flash", effort: "bogus"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := &MessagesOutbound{}
			_, err := o.TransformRequest(context.Background(), &model.InternalLLMRequest{
				Model:           tt.model,
				ReasoningEffort: tt.effort,
			}, "https://generativelanguage.googleapis.com", "test-key")
			if err == nil || !strings.Contains(err.Error(), "reasoning_effort="+tt.effort) {
				t.Fatalf("expected explicit unsupported-parameter error, got %v", err)
			}
		})
	}
}

func TestTransformRequestMapsXHighToGeminiMaximum(t *testing.T) {
	o := &MessagesOutbound{}
	req, err := o.TransformRequest(context.Background(), &model.InternalLLMRequest{
		Model:           "gemini-3.0-flash",
		ReasoningEffort: "xhigh",
	}, "https://generativelanguage.googleapis.com", "test-key")
	if err != nil {
		t.Fatalf("TransformRequest: %v", err)
	}
	var body struct {
		GenerationConfig struct {
			ThinkingConfig *model.GeminiThinkingConfig `json:"thinkingConfig"`
		} `json:"generationConfig"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if body.GenerationConfig.ThinkingConfig == nil || body.GenerationConfig.ThinkingConfig.ThinkingLevel != "high" {
		t.Fatalf("xhigh must map to Gemini's maximum high tier, got %+v", body.GenerationConfig.ThinkingConfig)
	}
}
