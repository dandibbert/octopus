package openai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

type openaiHTTPError struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

func TestChatInboundTransformErrorHTTPJSONUsesMachineCode(t *testing.T) {
	body, err := (&ChatInbound{}).TransformError(context.Background(), 429, "channel failed", model.ErrorOutputHTTPJSON)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(string(body), "data:") {
		t.Fatalf("HTTPJSON must not wrap SSE, got %s", body)
	}
	var payload openaiHTTPError
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if payload.Error.Message != "channel failed" || payload.Error.Type != "rate_limit_error" || payload.Error.Code != "rate_limit_exceeded" {
		t.Fatalf("unexpected payload %+v", payload)
	}
}

func TestChatInboundTransformErrorCommittedStreamIsSSE(t *testing.T) {
	body, err := (&ChatInbound{}).TransformError(context.Background(), 502, "channel failed", model.ErrorOutputCommittedStream)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(body), "data: ") || !strings.HasSuffix(string(body), "\n\n") {
		t.Fatalf("expected SSE data frame, got %q", body)
	}
	raw := strings.TrimSuffix(strings.TrimPrefix(string(body), "data: "), "\n\n")
	var payload openaiHTTPError
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("sse payload: %v body=%s", err, raw)
	}
	if payload.Error.Code != "server_error" {
		t.Fatalf("expected server_error, got %+v", payload)
	}
}

func TestResponseInboundTransformErrorHTTPJSONIsAPIErrorNotFailedResponse(t *testing.T) {
	body, err := (&ResponseInbound{}).TransformError(context.Background(), 429, "channel failed", model.ErrorOutputHTTPJSON)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"object":"response"`) || strings.Contains(string(body), `"status":"failed"`) {
		t.Fatalf("pre-stream Responses error must be HTTP API error, got %s", body)
	}
	var payload openaiHTTPError
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if payload.Error.Type != "rate_limit_error" || payload.Error.Code != "rate_limit_exceeded" {
		t.Fatalf("unexpected payload %+v", payload)
	}
}

func TestResponseInboundTransformErrorCommittedBeforeCreateUsesTopLevelError(t *testing.T) {
	body, err := (&ResponseInbound{}).TransformError(context.Background(), 429, "channel failed", model.ErrorOutputCommittedStream)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"type":"response.failed"`) {
		t.Fatalf("must not fabricate response.failed before response.created, got %s", body)
	}
	line := strings.TrimSpace(string(body))
	if i := strings.Index(line, "data: "); i >= 0 {
		line = strings.TrimSpace(line[i+len("data: "):])
	}
	var ev struct {
		Type           string  `json:"type"`
		SequenceNumber int     `json:"sequence_number"`
		Code           string  `json:"code"`
		Message        string  `json:"message"`
		Param          *string `json:"param"`
	}
	if err := json.Unmarshal([]byte(line), &ev); err != nil {
		t.Fatalf("unmarshal error event: %v body=%s", err, line)
	}
	if ev.Type != "error" || ev.Code != "rate_limit_exceeded" || ev.Message != "channel failed" {
		t.Fatalf("unexpected event %+v", ev)
	}
	if !strings.Contains(line, `"param":null`) {
		t.Fatalf("error event must carry param:null, got %s", line)
	}
}

func TestResponseInboundTransformErrorCommittedAfterCreateUsesResponseFailed(t *testing.T) {
	in := &ResponseInbound{
		hasResponseCreated: true,
		responseID:         "resp_test",
		model:              "gpt-test",
		createdAt:          123,
	}
	body, err := in.TransformError(context.Background(), 429, "channel failed", model.ErrorOutputCommittedStream)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(body)), "data: "))
	var ev struct {
		Type     string `json:"type"`
		Response struct {
			ID        string           `json:"id"`
			Model     string           `json:"model"`
			CreatedAt int64            `json:"created_at"`
			Status    string           `json:"status"`
			Output    []map[string]any `json:"output"`
			Error     struct {
				Code string `json:"code"`
			} `json:"error"`
		} `json:"response"`
	}
	if err := json.Unmarshal([]byte(line), &ev); err != nil {
		t.Fatalf("unmarshal failed event: %v body=%s", err, line)
	}
	if ev.Type != "response.failed" || ev.Response.Status != "failed" {
		t.Fatalf("unexpected event %+v", ev)
	}
	if ev.Response.ID != "resp_test" || ev.Response.Model != "gpt-test" || ev.Response.CreatedAt != 123 {
		t.Fatalf("response metadata lost: %+v", ev.Response)
	}
	if ev.Response.Error.Code != "rate_limit_exceeded" {
		t.Fatalf("error.code must be string machine code, got %+v", ev.Response.Error)
	}
	if ev.Response.Output == nil {
		t.Fatal("output must be [] not null")
	}
}

func TestEmbeddingInboundTransformErrorUsesOpenAIShape(t *testing.T) {
	body, err := (&EmbeddingInbound{}).TransformError(context.Background(), 401, "bad key", model.ErrorOutputHTTPJSON)
	if err != nil {
		t.Fatal(err)
	}
	var payload openaiHTTPError
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if payload.Error.Type != "authentication_error" || payload.Error.Code != "invalid_api_key" {
		t.Fatalf("unexpected payload %+v", payload)
	}
}
