package helper

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func TestApplyParamOverridesPrecedenceAndDelete(t *testing.T) {
	group := `{"temperature":null,"top_p":0.8,"keep":"group"}`
	channel := `{"temperature":0.2,"top_p":null}`
	req, err := http.NewRequest(http.MethodPost, "http://example.test", strings.NewReader(`{"temperature":1,"top_p":1,"keep":"original","untouched":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyParamOverrides(req, &group, &channel); err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got["temperature"] != 0.2 {
		t.Fatalf("temperature = %#v, want 0.2", got["temperature"])
	}
	if _, ok := got["top_p"]; ok {
		t.Fatalf("top_p should be deleted: %#v", got)
	}
	if got["keep"] != "group" || got["untouched"] != true {
		t.Fatalf("unexpected merged body: %#v", got)
	}
}

func TestMergeAndApplyCustomHeaders(t *testing.T) {
	headers := make(http.Header)
	headers.Set("X-Delete", "original")
	headers.Set("X-Empty", "original")
	merged := MergeCustomHeaders(
		[]model.CustomHeader{{HeaderKey: "X-Shared", HeaderValue: "group"}, {HeaderKey: "X-Delete", HeaderValue: "group"}},
		[]model.CustomHeader{{HeaderKey: "x-shared", HeaderValue: "channel"}, {HeaderKey: "X-Delete", Delete: true}, {HeaderKey: "X-Empty", HeaderValue: ""}},
	)
	ApplyCustomHeaders(headers, merged)
	if got := headers.Get("X-Shared"); got != "channel" {
		t.Fatalf("X-Shared = %q, want channel", got)
	}
	if _, ok := headers["X-Delete"]; ok {
		t.Fatalf("X-Delete should be absent: %#v", headers)
	}
	values, ok := headers["X-Empty"]
	if !ok || len(values) != 1 || values[0] != "" {
		t.Fatalf("X-Empty should exist with an empty value: %#v", headers)
	}
}
