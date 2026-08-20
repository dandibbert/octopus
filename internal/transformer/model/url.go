package model

import (
	"fmt"
	"net/url"
	"strings"
)

// ProviderBaseURL describes a channel base URL after applying the
// AxonHub-style "#" / "##" markers.
//
//	plain     keep as-is and append the default endpoint path
//	trailing #  strip the marker, do not auto-append an API version,
//	            but still join the default endpoint (e.g. /chat/completions)
//	trailing ## use the URL as the final request URL; do not append any path
type ProviderBaseURL struct {
	URL         *url.URL
	SkipVersion bool
	Raw         bool
}

// ParseProviderBaseURL parses a channel base URL and interprets optional
// "#" / "##" suffixes. Trailing slashes are normalized only when a later
// endpoint join may occur; raw "##" URLs are preserved exactly.
func ParseProviderBaseURL(raw string) (ProviderBaseURL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ProviderBaseURL{}, fmt.Errorf("base url is empty")
	}

	parsed := ProviderBaseURL{}
	switch {
	case strings.HasSuffix(raw, "##"):
		parsed.Raw = true
		parsed.SkipVersion = true
		raw = strings.TrimSuffix(raw, "##")
	case strings.HasSuffix(raw, "#"):
		parsed.SkipVersion = true
		raw = strings.TrimSuffix(raw, "#")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return ProviderBaseURL{}, fmt.Errorf("failed to parse base url: %w", err)
	}
	if !parsed.Raw {
		u.Path = strings.TrimRight(u.Path, "/")
	}
	parsed.URL = u
	return parsed, nil
}

// JoinProviderURL builds the final upstream URL from a channel base URL and
// the outbound default endpoint (e.g. "/chat/completions").
//
// Query parameters already present on the base URL are preserved. Callers
// that need extra query values should mutate the returned URL.
func JoinProviderURL(baseURL, defaultPath string) (*url.URL, error) {
	parsed, err := ParseProviderBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if parsed.Raw {
		return parsed.URL, nil
	}

	path := strings.TrimSpace(defaultPath)
	if path != "" && !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if path != "" {
		parsed.URL.Path = strings.TrimRight(parsed.URL.Path, "/") + path
	}
	return parsed.URL, nil
}
