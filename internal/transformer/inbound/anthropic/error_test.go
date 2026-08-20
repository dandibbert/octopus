package anthropic

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestMessagesInboundTransformErrorHTTPJSON(t *testing.T) {
	body, err := (&MessagesInbound{}).TransformError(context.Background(), 429, "channel failed", model.ErrorOutputHTTPJSON)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "event:") {
		t.Fatalf("HTTPJSON must not be SSE, got %s", body)
	}
	var payload AnthropicError
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if payload.Type != "error" || payload.Error.Type != "rate_limit_error" || payload.Error.Message != "channel failed" {
		t.Fatalf("unexpected payload %+v", payload)
	}
	if strings.Contains(string(body), `"request_id":""`) {
		t.Fatalf("synthetic error must not expose an empty request_id: %s", body)
	}
}

func TestAnthropicErrorTypeMappings(t *testing.T) {
	cases := map[int]string{
		400: "invalid_request_error",
		401: "authentication_error",
		402: "billing_error",
		403: "permission_error",
		404: "not_found_error",
		409: "conflict_error",
		413: "request_too_large",
		422: "invalid_request_error",
		429: "rate_limit_error",
		500: "api_error",
		504: "timeout_error",
		529: "overloaded_error",
	}
	for status, want := range cases {
		if got := anthropicErrorType(status); got != want {
			t.Errorf("status %d: got %q want %q", status, got, want)
		}
	}
}

func TestMessagesInboundTransformErrorCommittedStream(t *testing.T) {
	body, err := (&MessagesInbound{}).TransformError(context.Background(), 502, "channel failed", model.ErrorOutputCommittedStream)
	if err != nil {
		t.Fatal(err)
	}
	got := string(body)
	if !strings.Contains(got, "event:error") || !strings.Contains(got, `"type":"api_error"`) {
		t.Fatalf("expected anthropic SSE error, got %q", got)
	}
}
