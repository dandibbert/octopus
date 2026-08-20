package rewrite

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPrepareRequestAppliesRewriteAndDropsHopHeaders(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"t","op":"set","path":"/temperature","value":0.2},
			{"id":"h","op":"header_set","header":"X-Trace","value":"preview"}
		]
	}`
	plan, err := ParseAndCompile(&raw, ScopeChannel)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://example.invalid/v1/chat/completions", strings.NewReader(`{"model":"gpt","temperature":1}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Keep", "yes")
	req.Header.Set("Content-Length", "99")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Transfer-Encoding", "chunked")

	result, err := PrepareRequest(req, TransportHTTP, Context{RequestSource: "preview"}, nil, plan)
	if err != nil {
		t.Fatal(err)
	}
	if result == nil {
		t.Fatal("missing result")
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "0.2") {
		t.Fatalf("rewrite missing: %s", body)
	}
	if req.Header.Get("X-Trace") != "preview" {
		t.Fatalf("header rewrite missing: %v", req.Header)
	}
	if req.Header.Get("X-Keep") != "yes" {
		t.Fatalf("custom header dropped: %v", req.Header)
	}
	if req.Header.Get("Content-Length") != "" || req.Header.Get("Connection") != "" || req.Header.Get("Transfer-Encoding") != "" {
		t.Fatalf("hop headers survived: %v", req.Header)
	}
	if req.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("content-type=%q", req.Header.Get("Content-Type"))
	}
	if req.GetBody == nil {
		t.Fatal("GetBody should be set for retries")
	}
}

func TestPrepareRequestKeepsCustomHeaderWhenNoOps(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "https://example.invalid/v1/chat", strings.NewReader(`{"ok":true}`))
	req.Header.Set("X-Custom", "from-channel")
	req.Header.Set("Connection", "close")
	if _, err := PrepareRequest(req, TransportHTTP, Context{}, nil); err != nil {
		t.Fatal(err)
	}
	if req.Header.Get("X-Custom") != "from-channel" {
		t.Fatalf("custom header lost: %v", req.Header)
	}
	if req.Header.Get("Connection") != "" {
		t.Fatal("connection header should be stripped")
	}
}
