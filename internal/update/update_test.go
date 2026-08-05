package update

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bestruirui/octopus/internal/conf"
)

func TestReleaseURLsUseConfiguredRepository(t *testing.T) {
	if updateUrl != conf.Repo+"/releases/latest/download" {
		t.Fatalf("updateUrl = %q", updateUrl)
	}
	wantAPI := "https://api.github.com/repos/" + conf.RepoSlug + "/releases/latest"
	if updateApiUrl != wantAPI {
		t.Fatalf("updateApiUrl = %q, want %q", updateApiUrl, wantAPI)
	}
}

func TestGetLatestInfoWithoutReleaseIsNotAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
	}))
	defer server.Close()

	original := updateApiUrl
	updateApiUrl = server.URL
	defer func() { updateApiUrl = original }()

	info, err := GetLatestInfo()
	if err != nil {
		t.Fatalf("GetLatestInfo() error = %v", err)
	}
	if info == nil || info.TagName != "" {
		t.Fatalf("GetLatestInfo() = %+v, want empty release info", info)
	}
}

func TestGetLatestInfoParsesPublishedRelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.8.42","published_at":"2026-08-05T00:00:00Z","body":"notes"}`))
	}))
	defer server.Close()

	original := updateApiUrl
	updateApiUrl = server.URL
	defer func() { updateApiUrl = original }()

	info, err := GetLatestInfo()
	if err != nil {
		t.Fatalf("GetLatestInfo() error = %v", err)
	}
	if info.TagName != "v0.8.42" {
		t.Fatalf("TagName = %q", info.TagName)
	}
}
