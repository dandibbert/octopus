package model

import "testing"

func TestParseProviderBaseURL_Plain(t *testing.T) {
	got, err := ParseProviderBaseURL("https://api.openai.com/v1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Raw {
		t.Fatal("plain URL should not be raw")
	}
	if got.SkipVersion {
		t.Fatal("plain URL should not skip version")
	}
	if got.URL.String() != "https://api.openai.com/v1" {
		t.Fatalf("got %s", got.URL.String())
	}
}

func TestParseProviderBaseURL_HashSkipsVersionKeepsPathJoin(t *testing.T) {
	got, err := ParseProviderBaseURL("https://proxy.example.com/custom#")
	if err != nil {
		t.Fatal(err)
	}
	if got.Raw {
		t.Fatal("# should still allow default endpoint join")
	}
	if !got.SkipVersion {
		t.Fatal("# should skip auto version prefix")
	}
	if got.URL.Path != "/custom" {
		t.Fatalf("path = %q", got.URL.Path)
	}
}

func TestParseProviderBaseURL_DoubleHashIsRaw(t *testing.T) {
	got, err := ParseProviderBaseURL("https://proxy.example.com/openai/chat/completions##")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Raw {
		t.Fatal("## should mark raw URL mode")
	}
	if got.URL.Path != "/openai/chat/completions" {
		t.Fatalf("path = %q", got.URL.Path)
	}
}

func TestJoinProviderURL_AppendsDefaultPath(t *testing.T) {
	u, err := JoinProviderURL("https://api.openai.com/v1/", "/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != "/v1/chat/completions" {
		t.Fatalf("path = %q", u.Path)
	}
}

func TestJoinProviderURL_HashStillAppendsEndpoint(t *testing.T) {
	u, err := JoinProviderURL("https://proxy.example.com/gateway#", "/messages")
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != "/gateway/messages" {
		t.Fatalf("path = %q", u.Path)
	}
}

func TestJoinProviderURL_DoubleHashKeepsExactPath(t *testing.T) {
	u, err := JoinProviderURL("https://proxy.example.com/full/messages##", "/messages")
	if err != nil {
		t.Fatal(err)
	}
	if u.String() != "https://proxy.example.com/full/messages" {
		t.Fatalf("got %s", u.String())
	}
}

func TestJoinProviderURL_DoubleHashPreservesTrailingSlash(t *testing.T) {
	u, err := JoinProviderURL("https://proxy.example.com/full/messages/##", "/messages")
	if err != nil {
		t.Fatal(err)
	}
	if u.String() != "https://proxy.example.com/full/messages/" {
		t.Fatalf("raw URL trailing slash changed: %s", u.String())
	}
}

func TestJoinProviderURL_PreservesQuery(t *testing.T) {
	u, err := JoinProviderURL("https://api.openai.com/v1?api-version=2024-06-01", "/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	if u.Path != "/v1/chat/completions" {
		t.Fatalf("path = %q", u.Path)
	}
	if u.RawQuery != "api-version=2024-06-01" {
		t.Fatalf("query = %q", u.RawQuery)
	}
}
