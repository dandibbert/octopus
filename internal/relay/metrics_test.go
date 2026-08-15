package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	dbmodel "github.com/bestruirui/octopus/internal/model"
	transformerModel "github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/gin-gonic/gin"
)

// usage 完全缺失时，应使用 TransportInputTokens 兜底填充 input，output 保持 0。
func TestSetInternalResponseFallbackWhenUsageMissing(t *testing.T) {
	m := &RelayMetrics{TransportInputTokens: intPtr(123)}
	m.SetInternalResponse(&transformerModel.InternalLLMResponse{}, "test-model")

	if m.Stats.InputToken != 123 {
		t.Fatalf("input token: got %d want 123 (fallback)", m.Stats.InputToken)
	}
	if m.BillInputTokens == nil || *m.BillInputTokens != 123 {
		t.Fatalf("bill input tokens: got %v want 123", m.BillInputTokens)
	}
	if m.Stats.OutputToken != 0 {
		t.Fatalf("output token: got %d want 0", m.Stats.OutputToken)
	}
}

// usage 存在但输入侧全为 0（仅上报 output）时，input 兜底、output 保留。
func TestSetInternalResponseFallbackWhenInputZero(t *testing.T) {
	m := &RelayMetrics{TransportInputTokens: intPtr(50)}
	m.SetInternalResponse(&transformerModel.InternalLLMResponse{
		Usage: &transformerModel.Usage{PromptTokens: 0, CompletionTokens: 30},
	}, "test-model")

	if m.Stats.InputToken != 50 {
		t.Fatalf("input token: got %d want 50 (fallback)", m.Stats.InputToken)
	}
	if m.Stats.OutputToken != 30 {
		t.Fatalf("output token: got %d want 30 (preserved)", m.Stats.OutputToken)
	}
}

// 上游正常上报 input 时不触发兜底（保留真实值，而非估算值）。
func TestSetInternalResponseNoFallbackWhenInputReported(t *testing.T) {
	m := &RelayMetrics{TransportInputTokens: intPtr(999)}
	m.SetInternalResponse(&transformerModel.InternalLLMResponse{
		Usage: &transformerModel.Usage{PromptTokens: 12, CompletionTokens: 7},
	}, "test-model")

	if m.Stats.InputToken != 12 {
		t.Fatalf("input token: got %d want 12 (reported, not fallback)", m.Stats.InputToken)
	}
	if m.Stats.OutputToken != 7 {
		t.Fatalf("output token: got %d want 7", m.Stats.OutputToken)
	}
}

// 仅缓存命中（input_tokens=0 但 cache_read>0）属于已上报输入，不应被估算覆盖。
func TestSetInternalResponseNoFallbackWhenCacheOnly(t *testing.T) {
	m := &RelayMetrics{TransportInputTokens: intPtr(999)}
	m.SetInternalResponse(&transformerModel.InternalLLMResponse{
		Usage: &transformerModel.Usage{PromptTokens: 0, CacheReadInputTokens: 40, CompletionTokens: 5},
	}, "test-model")

	if m.Stats.InputToken != 0 {
		t.Fatalf("input token: got %d want 0 (cache-only is reported input)", m.Stats.InputToken)
	}
}

func TestRelayMetricsAggregateStatsOnlyForAPI(t *testing.T) {
	tests := []struct {
		source string
		want   bool
	}{
		{source: "", want: true},
		{source: dbmodel.RelayLogRequestSourceAPI, want: true},
		{source: dbmodel.RelayLogRequestSourcePlayground, want: false},
		{source: dbmodel.RelayLogRequestSourceHealthCheck, want: false},
	}
	for _, tt := range tests {
		metrics := &RelayMetrics{RequestSource: tt.source}
		if got := metrics.shouldAggregateStats(); got != tt.want {
			t.Fatalf("source %q: shouldAggregateStats=%t, want %t", tt.source, got, tt.want)
		}
	}
}

func TestAdminExecutionMetadataIncludesRouteAndKnownCost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	stream := true
	metrics := &RelayMetrics{
		RequestSource: dbmodel.RelayLogRequestSourcePlayground,
		ActualModel:   "actual-model",
		Stats: dbmodel.StatsMetrics{
			InputToken:  10,
			OutputToken: 4,
			InputCost:   0.1,
			OutputCost:  0.2,
		},
		BilledPrice: dbmodel.PriceResolution{Status: dbmodel.BillingStatusResolved},
	}
	ra := &relayAttempt{
		relayRequest: &relayRequest{
			c:               c,
			metrics:         metrics,
			requestModel:    "requested-group",
			internalRequest: &transformerModel.InternalLLMRequest{Model: "remote-model", Stream: &stream},
		},
		channel: &dbmodel.Channel{Name: "selected-channel"},
	}

	ra.setExecutionMetadataHeaders()
	if recorder.Header().Get("X-Octopus-Estimated-Cost") == "" {
		t.Fatal("known price should expose an estimated cost header")
	}
	ra.writeExecutionMetadataEvent()
	body := recorder.Body.String()
	dataIndex := strings.Index(body, "data: ")
	if dataIndex < 0 {
		t.Fatalf("metadata SSE event missing: %q", body)
	}
	data := strings.TrimSpace(body[dataIndex+len("data: "):])
	var payload map[string]any
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		t.Fatalf("decode metadata event: %v", err)
	}
	if payload["channel_name"] != "selected-channel" || payload["remote_model"] != "remote-model" || payload["requested_model"] != "requested-group" {
		t.Fatalf("metadata route fields missing: %#v", payload)
	}
	if _, ok := payload["estimated_cost"]; !ok {
		t.Fatalf("known price metadata should include estimated_cost: %#v", payload)
	}
}

func TestAdminExecutionMetadataOmitsUnknownCost(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	metrics := &RelayMetrics{
		RequestSource: dbmodel.RelayLogRequestSourcePlayground,
		BilledPrice:   dbmodel.PriceResolution{Status: dbmodel.BillingStatusUnknown},
	}
	ra := &relayAttempt{relayRequest: &relayRequest{c: c, metrics: metrics}}
	ra.setExecutionMetadataHeaders()
	if got := recorder.Header().Get("X-Octopus-Estimated-Cost"); got != "" {
		t.Fatalf("unknown price must not be reported as zero cost, got %q", got)
	}
}
