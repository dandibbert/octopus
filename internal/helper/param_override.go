package helper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ApplyParamOverrides merges JSON-object overrides into an outbound JSON request body.
// Overrides are applied left-to-right, so later scopes win. JSON null means delete the
// final request field, but remains an ordinary merge value until the final application;
// this lets a later scope restore a value deleted by an earlier scope.
// Empty/invalid overrides, nil bodies, and non-object request bodies are ignored.
func ApplyParamOverrides(request *http.Request, paramOverrides ...*string) error {
	if request == nil || request.Body == nil || len(paramOverrides) == 0 {
		return nil
	}

	body, err := io.ReadAll(request.Body)
	if err != nil {
		return fmt.Errorf("failed to read request body: %w", err)
	}

	restoreBody := func() {
		request.Body = io.NopCloser(bytes.NewReader(body))
		request.ContentLength = int64(len(body))
		request.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(body)), nil
		}
	}

	var bodyMap map[string]any
	if err := json.Unmarshal(body, &bodyMap); err != nil {
		restoreBody()
		return nil
	}

	merged := make(map[string]any)
	configured := false
	for _, raw := range paramOverrides {
		if raw == nil || strings.TrimSpace(*raw) == "" {
			continue
		}
		var override map[string]any
		if err := json.Unmarshal([]byte(*raw), &override); err != nil {
			continue
		}
		for key, value := range override {
			merged[key] = value
		}
		configured = true
	}
	if !configured {
		restoreBody()
		return nil
	}

	for key, value := range merged {
		if value == nil {
			delete(bodyMap, key)
			continue
		}
		bodyMap[key] = value
	}

	modifiedBody, err := json.Marshal(bodyMap)
	if err != nil {
		return fmt.Errorf("failed to marshal request body with param override: %w", err)
	}

	request.Body = io.NopCloser(bytes.NewReader(modifiedBody))
	request.ContentLength = int64(len(modifiedBody))
	request.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(modifiedBody)), nil
	}
	return nil
}

// ApplyParamOverride keeps the legacy single-scope API for callers outside relay.
func ApplyParamOverride(request *http.Request, paramOverride *string) error {
	return ApplyParamOverrides(request, paramOverride)
}
