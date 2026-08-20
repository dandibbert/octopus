package rewrite

import (
	"net/http"
	"testing"
)

func TestParseJSONPointerEscapes(t *testing.T) {
	p, err := parseJSONPointer("/metadata/a~1b")
	if err != nil {
		t.Fatal(err)
	}
	if p.tokens[1].name != "a/b" {
		t.Fatalf("unescape failed: %#v", p.tokens[1])
	}
	p, err = parseJSONPointer("/metadata/a~0b")
	if err != nil {
		t.Fatal(err)
	}
	if p.tokens[1].name != "a~b" {
		t.Fatalf("tilde unescape failed: %#v", p.tokens[1])
	}
}

func TestRootPathForbidden(t *testing.T) {
	if _, err := parseJSONPointer(""); err == nil {
		t.Fatal("root path should be rejected")
	}
}

func FuzzParseJSONPointer(f *testing.F) {
	f.Add("/model")
	f.Add("/tools/0/function/name")
	f.Add("/metadata/a~1b")
	f.Add("/*/-1")
	f.Fuzz(func(t *testing.T, raw string) {
		_, _ = parseJSONPointer(raw)
	})
}

func FuzzDecodeLegacyAndV2(f *testing.F) {
	f.Add(`{"temperature":0.2}`)
	f.Add(`{"$schema":"octopus.request-rewrite/v2","operations":[]}`)
	f.Add(`{"operations":[]}`)
	f.Fuzz(func(t *testing.T, raw string) {
		_, _ = ParseAndCompile(&raw, ScopeChannel)
	})
}

func FuzzApplyNoPanic(f *testing.F) {
	f.Add(`{"a":1}`, `{"temperature":0.2}`)
	f.Fuzz(func(t *testing.T, body, cfg string) {
		plan, err := ParseAndCompile(&cfg, ScopeChannel)
		if err != nil {
			return
		}
		_, _ = Apply(Input{Body: []byte(body)}, plan)
	})
}

func FuzzConditionNoPanic(f *testing.F) {
	f.Add(`{"source":"body","path":"/model","operator":"eq","value":"x"}`)
	f.Add(`{"all":[{"source":"body","path":"/x","operator":"exists"}]}`)
	f.Add(`{"any":[{"source":"header","path":"X-Trace","operator":"missing"}]}`)
	f.Add(`{"not":{"source":"context","path":"request.stream","operator":"eq","value":true}}`)
	f.Fuzz(func(t *testing.T, raw string) {
		cfg := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"a","op":"set","path":"/ok","value":true,"when":` + raw + `}]}`
		plan, err := ParseAndCompile(&cfg, ScopeChannel)
		if err != nil {
			return
		}
		_, _ = Apply(Input{Body: []byte(`{"model":"gpt","x":null}`), Headers: http.Header{"X-Trace": []string{"1"}}}, plan)
	})
}
