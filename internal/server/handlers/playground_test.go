package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/op"
	"github.com/gin-gonic/gin"
)

func TestValidateHealthCompletion(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		wantErr string
	}{
		{name: "valid", status: http.StatusOK, body: `{"model":"gpt-test","choices":[{"message":{"role":"assistant","content":"OK"}}]}`},
		{name: "empty object", status: http.StatusOK, body: `{}`, wantErr: "no completion choices"},
		{name: "error object", status: http.StatusOK, body: `{"error":{"message":"failed"}}`, wantErr: "error response"},
		{name: "null choice", status: http.StatusOK, body: `{"choices":[null]}`, wantErr: "invalid completion choice"},
		{name: "empty choice", status: http.StatusOK, body: `{"choices":[{}]}`, wantErr: "invalid completion choice"},
		{name: "scalar choice", status: http.StatusOK, body: `{"choices":[123]}`, wantErr: "invalid JSON"},
		{name: "invalid json", status: http.StatusOK, body: `{`, wantErr: "invalid JSON"},
		{name: "http failure", status: http.StatusBadGateway, body: `{}`, wantErr: "HTTP 502"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			completion, err := validateHealthCompletion(tt.status, []byte(tt.body))
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if completion.Model != "gpt-test" {
					t.Fatalf("unexpected model: %q", completion.Model)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestSanitizeExecutionErrorRedactsCommonSecrets(t *testing.T) {
	raw := `Authorization: Bearer secret-token x-api-key=provider-secret api-key: another-secret https://example.test?api_key=query-secret&foo=bar sk-test_12345678`
	got := sanitizeExecutionError(raw)
	for _, secret := range []string{"secret-token", "provider-secret", "another-secret", "query-secret", "sk-test_12345678"} {
		if strings.Contains(got, secret) {
			t.Fatalf("secret %q was not redacted: %s", secret, got)
		}
	}
	if !strings.Contains(got, "foo=bar") {
		t.Fatalf("non-sensitive query parameter was unexpectedly removed: %s", got)
	}
	if parameter := sanitizeExecutionError("unsupported parameter: max_tokens"); parameter != "unsupported parameter: max_tokens" {
		t.Fatalf("ordinary parameter name was unexpectedly redacted: %s", parameter)
	}
}

func TestEnforceAdminRateLimit(t *testing.T) {
	const key = -999999
	op.RateLimitDel(key)
	t.Cleanup(func() { op.RateLimitDel(key) })

	first, _ := gin.CreateTestContext(httptest.NewRecorder())
	if !enforceAdminRateLimit(first, key, 1) {
		t.Fatal("first request should be allowed")
	}

	recorder := httptest.NewRecorder()
	second, _ := gin.CreateTestContext(recorder)
	if enforceAdminRateLimit(second, key, 1) {
		t.Fatal("second request in the same minute should be rejected")
	}
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") == "" {
		t.Fatalf("unexpected rate-limit response: status=%d retry-after=%q", recorder.Code, recorder.Header().Get("Retry-After"))
	}
	var payload struct {
		ErrorCode string         `json:"error_code"`
		Params    map[string]any `json:"params"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode rate-limit response: %v", err)
	}
	if payload.ErrorCode != codePlaygroundRateLimited {
		t.Fatalf("unexpected error code: %q", payload.ErrorCode)
	}
	if payload.Params["maxRPM"] != float64(1) {
		t.Fatalf("unexpected error params: %#v", payload.Params)
	}
}

func TestBuildPlaygroundRelayRequestValidationCodes(t *testing.T) {
	temperature := 3.0
	maxOutputTokens := 0
	tests := []struct {
		name string
		req  playgroundChatRequest
		code string
	}{
		{
			name: "unsupported role",
			req: playgroundChatRequest{
				Target:   playgroundTarget{Type: "group", Group: "test"},
				Messages: []playgroundMessage{{Role: "tool", Content: "hello"}},
			},
			code: codePlaygroundUnsupportedRole,
		},
		{
			name: "temperature out of range",
			req: playgroundChatRequest{
				Target:     playgroundTarget{Type: "group", Group: "test"},
				Messages:   []playgroundMessage{{Role: "user", Content: "hello"}},
				Parameters: playgroundParameters{Temperature: &temperature},
			},
			code: codePlaygroundTemperatureRange,
		},
		{
			name: "max output tokens out of range",
			req: playgroundChatRequest{
				Target:     playgroundTarget{Type: "group", Group: "test"},
				Messages:   []playgroundMessage{{Role: "user", Content: "hello"}},
				Parameters: playgroundParameters{MaxOutputTokens: &maxOutputTokens},
			},
			code: codePlaygroundMaxOutputTokensRange,
		},
		{
			name: "invalid reasoning effort",
			req: playgroundChatRequest{
				Target:     playgroundTarget{Type: "group", Group: "test"},
				Messages:   []playgroundMessage{{Role: "user", Content: "hello"}},
				Parameters: playgroundParameters{ReasoningEffort: "extreme"},
			},
			code: codePlaygroundInvalidReasoningEffort,
		},
		{
			name: "missing group target",
			req: playgroundChatRequest{
				Target:   playgroundTarget{Type: "group"},
				Messages: []playgroundMessage{{Role: "user", Content: "hello"}},
			},
			code: codePlaygroundTargetRequired,
		},
		{
			name: "missing channel model target",
			req: playgroundChatRequest{
				Target:   playgroundTarget{Type: "channel_model"},
				Messages: []playgroundMessage{{Role: "user", Content: "hello"}},
			},
			code: codePlaygroundTargetRequired,
		},
		{
			name: "unsupported target type",
			req: playgroundChatRequest{
				Target:   playgroundTarget{Type: "other"},
				Messages: []playgroundMessage{{Role: "user", Content: "hello"}},
			},
			code: codePlaygroundUnsupportedTargetType,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/playground/chat", nil)
			_, _, err := buildPlaygroundRelayRequest(c, tt.req)
			var apiErr *playgroundAPIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("expected playgroundAPIError, got %T: %v", err, err)
			}
			if apiErr.code != tt.code {
				t.Fatalf("unexpected error code: got %q want %q", apiErr.code, tt.code)
			}
		})
	}
}
