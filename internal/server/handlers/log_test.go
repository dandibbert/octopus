package handlers

import "testing"

func TestParseRelayLogRequestSources(t *testing.T) {
	sources, err := parseRelayLogRequestSources("playground,api,playground")
	if err != nil {
		t.Fatalf("parse valid sources: %v", err)
	}
	if len(sources) != 2 || sources[0] != "playground" || sources[1] != "api" {
		t.Fatalf("unexpected parsed sources: %#v", sources)
	}

	if _, err := parseRelayLogRequestSources("unknown"); err == nil {
		t.Fatal("expected invalid request source to be rejected")
	}
}
