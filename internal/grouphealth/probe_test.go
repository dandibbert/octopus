package grouphealth

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/rewrite"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
)

func TestBuildProbeRequestForResponses(t *testing.T) {
	channel := &model.Channel{
		Type:     outbound.OutboundTypeOpenAIResponse,
		BaseUrls: []model.BaseUrl{{URL: "https://example.com/v1"}},
	}
	usedKey := &model.ChannelKey{ID: 1, ChannelKey: "sk-test"}

	req, err := buildProbeRequest(context.Background(), channel, usedKey, "gpt-5.4")
	if err != nil {
		t.Fatalf("buildProbeRequest returned error: %v", err)
	}
	if req.URL.Path != "/v1/responses" {
		t.Fatalf("expected /v1/responses, got %s", req.URL.Path)
	}
}

func TestBuildProbeRequestForEmbeddings(t *testing.T) {
	channel := &model.Channel{
		Type:     outbound.OutboundTypeOpenAIEmbedding,
		BaseUrls: []model.BaseUrl{{URL: "https://example.com/v1"}},
	}
	usedKey := &model.ChannelKey{ID: 1, ChannelKey: "sk-test"}

	req, err := buildProbeRequest(context.Background(), channel, usedKey, "text-embedding-3-large")
	if err != nil {
		t.Fatalf("buildProbeRequest returned error: %v", err)
	}
	if req.URL.Path != "/v1/embeddings" {
		t.Fatalf("expected /v1/embeddings, got %s", req.URL.Path)
	}
}

func TestProbeAppliesChannelRewriteContext(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"t","op":"set","path":"/temperature","value":0.1}]
	}`
	channel := model.Channel{
		Type:          outbound.OutboundTypeOpenAIChat,
		BaseUrls:      []model.BaseUrl{{URL: "https://example.invalid/v1"}},
		ParamOverride: &raw,
	}
	usedKey := model.ChannelKey{ID: 1, ChannelKey: "sk-test"}
	req, err := buildProbeRequest(context.Background(), &channel, &usedKey, "gpt-4o")
	if err != nil {
		t.Fatal(err)
	}
	applyCustomHeaders(req, nil)
	plan, err := rewrite.CompileCached(channel.ParamOverride, rewrite.ScopeChannel)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rewrite.PrepareRequest(req, rewrite.TransportHTTP, rewrite.Context{
		RequestSource:      "health_check",
		FlagsIsHealthCheck: true,
	}, nil, plan); err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "0.1") {
		t.Fatalf("probe rewrite missing: %s", body)
	}
}
