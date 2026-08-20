package rewrite

import (
	"net/http"
	"strings"
	"testing"
)

func TestP1StringOps(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"trim","op":"trim_prefix","path":"/model","value":"openai/"},
			{"id":"ensure","op":"ensure_prefix","path":"/model","value":"openai/"},
			{"id":"space","op":"trim_space","path":"/note"},
			{"id":"lower","op":"to_lower","path":"/note"},
			{"id":"repl","op":"replace","path":"/note","search":"hello","replacement":"hi"},
			{"id":"re","op":"regex_replace","path":"/note","pattern":"hi-","replacement":""}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"model":"openai/gpt","note":" Hello-WORLD "}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"model":"openai/gpt"`) {
		t.Fatalf("model=%s", res.Body)
	}
	if !strings.Contains(string(res.Body), `"note":"world"`) && !strings.Contains(string(res.Body), `"note": "world"`) {
		t.Fatalf("note=%s", res.Body)
	}
}

func TestHeaderPassNeverCopiesAuth(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"pass","op":"header_pass","value":["Authorization","X-Request-Id","*"]}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	inbound := http.Header{}
	inbound.Set("Authorization", "Bearer secret")
	inbound.Set("X-Request-Id", "abc")
	res, err := Apply(Input{
		Body:           []byte(`{}`),
		Headers:        http.Header{},
		InboundHeaders: inbound,
	}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Headers.Get("Authorization"); got != "" {
		t.Fatalf("auth leaked: %q", got)
	}
	if got := res.Headers.Get("X-Request-Id"); got != "abc" {
		t.Fatalf("x-request-id=%q", got)
	}
}

func TestSyncFieldsHeaderToBody(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"sync","op":"sync_fields","path":"/user","header":"X-User"}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	headers := http.Header{}
	headers.Set("X-User", "alice")
	res, err := Apply(Input{Body: []byte(`{}`), Headers: headers}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"user":"alice"`) && !strings.Contains(string(res.Body), `"user": "alice"`) {
		t.Fatalf("body=%s", res.Body)
	}
}

func TestPruneObjectsRemovesMatching(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{
			"id":"prune",
			"op":"prune_objects",
			"path":"/tools",
			"item_when":{"source":"item","path":"/type","operator":"eq","value":"drop"}
		}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"tools":[{"type":"drop"},{"type":"keep"}]}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(res.Body), `"drop"`) {
		t.Fatalf("drop still present: %s", res.Body)
	}
	if !strings.Contains(string(res.Body), `"keep"`) {
		t.Fatalf("keep missing: %s", res.Body)
	}
}
