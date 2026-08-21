package rewrite

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func mustCompile(t *testing.T, raw string, scope Scope) *Plan {
	t.Helper()
	plan, err := ParseAndCompile(&raw, scope)
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestLegacyOverrideMatchesOldSemantics(t *testing.T) {
	group := `{"temperature":null,"top_p":0.8,"keep":"group"}`
	channel := `{"temperature":0.2,"top_p":null}`
	body := []byte(`{"temperature":1,"top_p":1,"keep":"original","untouched":true}`)
	g := mustCompile(t, group, ScopeGroup)
	c := mustCompile(t, channel, ScopeChannel)
	res, err := Apply(Input{Body: body, Headers: http.Header{}}, g, c)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(res.Body, &got); err != nil {
		t.Fatal(err)
	}
	if got["temperature"] != 0.2 {
		t.Fatalf("temperature=%v", got["temperature"])
	}
	if _, ok := got["top_p"]; ok {
		t.Fatalf("top_p should be deleted: %#v", got)
	}
	if got["keep"] != "group" || got["untouched"] != true {
		t.Fatalf("unexpected body %#v", got)
	}
}

func TestV2DoesNotFallbackLegacy(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"x","op":"not-real"}]}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestMissingSchemaThatLooksLikeV2(t *testing.T) {
	raw := `{"operations":[{"id":"x","op":"set","path":"/a","value":1}]}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("expected missing schema error")
	}
}

func TestUnknownSchemaRejected(t *testing.T) {
	raw := `{"$schema":"nope","operations":[]}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("expected unknown schema error")
	}
}

func TestV2ExplicitNullSet(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"stage":"outbound_provider",
		"operations":[{"id":"n","op":"set","path":"/top_p","value":null}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"top_p":1}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"top_p":null`) && !strings.Contains(string(res.Body), `"top_p": null`) {
		t.Fatalf("expected explicit null, got %s", res.Body)
	}
}

func TestSetIfAbsentAndNestedCreate(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"a","op":"set_if_absent","path":"/reasoning/effort","value":"high"},
			{"id":"b","op":"set_if_absent","path":"/model","value":"skip-me"}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"model":"keep"}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(res.Body, &got)
	if got["model"] != "keep" {
		t.Fatalf("model rewritten: %#v", got)
	}
	reasoning, _ := got["reasoning"].(map[string]any)
	if reasoning["effort"] != "high" {
		t.Fatalf("nested set failed: %#v", got)
	}
}

func TestConditionsSeePriorOps(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"a","op":"set","path":"/model","value":"claude-3"},
			{"id":"b","op":"set","path":"/flag","value":true,"when":{"source":"body","path":"/model","operator":"prefix","value":"claude-"}}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"model":"gpt"}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"flag":true`) && !strings.Contains(string(res.Body), `"flag": true`) {
		t.Fatalf("condition did not see prior body: %s", res.Body)
	}
}

func TestConditionCaseInsensitiveEqInAndRegex(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"eq","op":"set","path":"/eq","value":true,"when":{"source":"body","path":"/name","operator":"eq","value":"claude","case_sensitive":false}},
			{"id":"in","op":"set","path":"/in","value":true,"when":{"source":"body","path":"/name","operator":"in","value":["gpt","claude"],"case_sensitive":false}},
			{"id":"regex","op":"set","path":"/regex","value":true,"when":{"source":"body","path":"/name","operator":"regex","value":"^claude$","case_sensitive":false}}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"name":"CLAUDE"}`)}, plan)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"eq", "in", "regex"} {
		if !strings.Contains(string(res.Body), `"`+field+`":true`) && !strings.Contains(string(res.Body), `"`+field+`": true`) {
			t.Fatalf("case-insensitive %s did not match: %s", field, res.Body)
		}
	}
}

func TestJSONPointerEscapes(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"a","op":"set","path":"/metadata/a~1b","value":1}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"metadata":{"a/b":0}}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"a/b"`) {
		t.Fatalf("escaped key lost: %s", res.Body)
	}
}

func TestArrayRemove(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{
			"id":"rm",
			"op":"array_remove",
			"path":"/tools",
			"item_when":{"source":"item","path":"/function/name","operator":"eq","value":"web_search"}
		}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	body := []byte(`{"tools":[{"function":{"name":"web_search"}},{"function":{"name":"code"}}]}`)
	res, err := Apply(Input{Body: body, Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(res.Body), "web_search") {
		t.Fatalf("item not removed: %s", res.Body)
	}
	if !strings.Contains(string(res.Body), "code") {
		t.Fatalf("kept item missing: %s", res.Body)
	}
}

func TestHeaderFinalSetAndDelete(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"s","op":"header_set","header":"X-Trace","value":"abc"},
			{"id":"d","op":"header_delete","header":"X-Drop"}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	h := http.Header{}
	h.Set("X-Drop", "gone")
	res, err := Apply(Input{Body: []byte(`{}`), Headers: h}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if res.Headers.Get("X-Trace") != "abc" {
		t.Fatalf("header set failed: %v", res.Headers)
	}
	if res.Headers.Get("X-Drop") != "" {
		t.Fatalf("header delete failed: %v", res.Headers)
	}
}

func TestSensitiveHeaderRejectedOnGroup(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"s","op":"header_set","header":"Authorization","value":"secret"}]
	}`
	if _, err := ParseAndCompile(&raw, ScopeGroup); err == nil {
		t.Fatal("group should reject sensitive header")
	}
}

func TestReturnErrorStop(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{
			"id":"stop",
			"op":"return_error",
			"when":{"source":"body","path":"/model","operator":"eq","value":"bad"},
			"error":{"message":"blocked","status":400,"code":"blocked"}
		}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	_, err := Apply(Input{Body: []byte(`{"model":"bad"}`), Headers: http.Header{}}, plan)
	ae, ok := err.(*ApplyError)
	if !ok || ae.Code != "blocked" || ae.StatusCode != 400 {
		t.Fatalf("unexpected error %#v", err)
	}
}

func TestGroupThenChannelOrder(t *testing.T) {
	group := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"g","op":"set","path":"/keep","value":"group"}]
	}`
	channel := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"c","op":"set","path":"/keep","value":"channel"}]
	}`
	res, err := Apply(Input{Body: []byte(`{}`), Headers: http.Header{}},
		mustCompile(t, group, ScopeGroup), mustCompile(t, channel, ScopeChannel))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"keep":"channel"`) && !strings.Contains(string(res.Body), `"keep": "channel"`) {
		t.Fatalf("channel should win: %s", res.Body)
	}
}

func TestNextChannelRejectedOnGroup(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"e","op":"return_error","error":{"message":"x","retry":"next_channel"}}]
	}`
	if _, err := ParseAndCompile(&raw, ScopeGroup); err == nil {
		t.Fatal("expected group next_channel rejection")
	}
}

func TestDuplicateOperationID(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"a","op":"set","path":"/x","value":1},
			{"id":"a","op":"set","path":"/y","value":2}
		]
	}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("expected duplicate id error")
	}
}

func TestApplyToRequestSetsGetBody(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"a","op":"set","path":"/temperature","value":0.2}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	req, err := http.NewRequest(http.MethodPost, "http://example.test", strings.NewReader(`{"temperature":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyToRequest(req, TransportHTTP, Context{}, nil, plan); err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "0.2") {
		t.Fatalf("body=%s", body)
	}
	if req.GetBody == nil {
		t.Fatal("GetBody not set")
	}
	r2, err := req.GetBody()
	if err != nil {
		t.Fatal(err)
	}
	body2, _ := io.ReadAll(r2)
	if string(body) != string(body2) {
		t.Fatalf("GetBody mismatch %s vs %s", body, body2)
	}
}

func TestExistsTreatsNullAsPresent(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"a","op":"set","path":"/ok","value":true,"when":{"source":"body","path":"/x","operator":"exists"}}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"x":null}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"ok":true`) && !strings.Contains(string(res.Body), `"ok": true`) {
		t.Fatalf("exists should match null: %s", res.Body)
	}
}

func TestBigIntComparison(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"a","op":"set","path":"/ok","value":true,"when":{"source":"body","path":"/n","operator":"gt","value":9007199254740993}}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{Body: []byte(`{"n":9007199254740994}`), Headers: http.Header{}}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"ok":true`) && !strings.Contains(string(res.Body), `"ok": true`) {
		t.Fatalf("bigint compare failed: %s", res.Body)
	}
}

func TestValueFromHeaderAndTemplate(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"h","op":"header_set","header":"X-Model","value_from":{"source":"context","path":"request.original_model"}},
			{"id":"t","op":"set","path":"/label","value_template":"model-${context:request.original_model}"}
		]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	res, err := Apply(Input{
		Body:    []byte(`{}`),
		Headers: http.Header{},
		Context: Context{RequestOriginalModel: "gpt-4o"},
	}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if res.Headers.Get("X-Model") != "gpt-4o" {
		t.Fatalf("header=%q", res.Headers.Get("X-Model"))
	}
	if !strings.Contains(string(res.Body), "model-gpt-4o") {
		t.Fatalf("template failed: %s", res.Body)
	}
}

func TestNoConfigFastPath(t *testing.T) {
	body := []byte(`{"a":1}`)
	res, err := Apply(Input{Body: body, Headers: http.Header{}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed {
		t.Fatal("no-config should not change")
	}
}

func TestRetryDoesNotReapplyAppend(t *testing.T) {
	raw := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"a","op":"array_append","path":"/messages","value":{"role":"system","content":"hint"}}]
	}`
	plan := mustCompile(t, raw, ScopeChannel)
	fresh := []byte(`{"messages":[{"role":"user","content":"hi"}]}`)
	first, err := Apply(Input{Body: append([]byte(nil), fresh...)}, plan)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Apply(Input{Body: append([]byte(nil), fresh...)}, plan)
	if err != nil {
		t.Fatal(err)
	}
	if string(first.Body) != string(second.Body) {
		t.Fatalf("retry reused mutated body:\n%s\n%s", first.Body, second.Body)
	}
	if strings.Count(string(first.Body), `"hint"`) != 1 {
		t.Fatalf("append should happen once: %s", first.Body)
	}
}

func TestDirectChannelSkipsNilGroupPlan(t *testing.T) {
	channel := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"c","op":"set","path":"/keep","value":"channel"}]
	}`
	res, err := Apply(Input{Body: []byte(`{"keep":"orig"}`)}, nil, mustCompile(t, channel, ScopeChannel))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(res.Body), `"keep":"channel"`) && !strings.Contains(string(res.Body), `"keep": "channel"`) {
		t.Fatalf("channel rewrite missing: %s", res.Body)
	}
}

func TestV2RejectsUnknownFields(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[],"typo_field":true}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("expected unknown V2 field to be rejected")
	}
}

func TestV2LookingConfigRequiresSchema(t *testing.T) {
	for _, raw := range []string{
		`{"stage":"outbound_provider"}`,
		`{"policy":{"on_error":"reject"}}`,
		`{"allow_sensitive_headers":true}`,
	} {
		if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
			t.Fatalf("expected missing schema error for %s", raw)
		}
	}
}

func TestConditionOperatorRequiresTypedValue(t *testing.T) {
	cases := []string{
		`{"source":"body","path":"/x","operator":"eq"}`,
		`{"source":"body","path":"/x","operator":"prefix","value":1}`,
		`{"source":"body","path":"/x","operator":"gt","value":"1"}`,
		`{"source":"body","path":"/x","operator":"in","value":"x"}`,
		`{"source":"body","path":"/x","operator":"type_is","value":"wat"}`,
	}
	for _, condition := range cases {
		raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"x","op":"set","path":"/ok","value":true,"when":` + condition + `}]}`
		if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
			t.Fatalf("expected invalid condition value for %s", condition)
		}
	}
}

func TestSensitiveHeadersCannotBeRead(t *testing.T) {
	cases := []string{
		`{"id":"v","op":"set","path":"/leak","value_from":{"source":"header","path":"Authorization"}}`,
		`{"id":"t","op":"set","path":"/leak","value_template":"${header:Authorization}"}`,
		`{"id":"c","op":"set","path":"/ok","value":true,"when":{"source":"header","path":"Authorization","operator":"exists"}}`,
		`{"id":"h","op":"header_copy","from_header":"Authorization","to_header":"X-Leak"}`,
		`{"id":"s","op":"sync_fields","path":"/secret","header":"Authorization"}`,
	}
	for _, operation := range cases {
		raw := `{"$schema":"octopus.request-rewrite/v2","allow_sensitive_headers":true,"operations":[` + operation + `]}`
		if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
			t.Fatalf("expected sensitive header read to be rejected: %s", operation)
		}
	}
}

func TestHeaderSetConflictPolicy(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"h","op":"header_set","header":"X-Test","value":"new","policy":{"on_conflict":"error"}}]}`
	plan := mustCompile(t, raw, ScopeChannel)
	_, err := Apply(Input{Body: []byte(`{}`), Headers: http.Header{"X-Test": []string{"old"}}}, plan)
	if err == nil {
		t.Fatal("expected header conflict error")
	}
}

func TestHTTPAllowsWSOnlyFieldsButWSBlocksThem(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"b","op":"set","path":"/background","value":true}]}`
	plan := mustCompile(t, raw, ScopeChannel)
	if _, err := Apply(Input{Body: []byte(`{}`), Headers: http.Header{}, Transport: TransportHTTP}, plan); err != nil {
		t.Fatalf("HTTP should allow background rewrite: %v", err)
	}
	if _, err := Apply(Input{Body: []byte(`{}`), Headers: http.Header{}, Transport: TransportWS}, plan); err == nil {
		t.Fatal("WS should reject background rewrite")
	}
}

func TestArrayOpsCannotBypassProtectedFields(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"s","op":"array_append","path":"/stream","value":true}]}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("array operation on protected stream field should be rejected")
	}
}

func TestReturnErrorStatusRange(t *testing.T) {
	raw := `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"e","op":"return_error","error":{"status":200,"message":"nope"}}]}`
	if _, err := ParseAndCompile(&raw, ScopeChannel); err == nil {
		t.Fatal("return_error should reject non-error status")
	}
}
