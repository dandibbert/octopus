package rewrite

import (
	"net/http"
	"testing"
)

func BenchmarkRewriteNoConfig(b *testing.B) {
	body := []byte(`{"model":"gpt","messages":[{"role":"user","content":"hi"}]}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = Apply(Input{Body: body})
	}
}

func BenchmarkRewriteSimpleSet1KB(b *testing.B) {
	cfg := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"t","op":"set","path":"/temperature","value":0.2}]
	}`
	plan, err := ParseAndCompile(&cfg, ScopeChannel)
	if err != nil {
		b.Fatal(err)
	}
	body := []byte(`{"model":"gpt","temperature":1,"prompt":"` + stringsRepeat("x", 900) + `"}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = Apply(Input{Body: append([]byte(nil), body...)}, plan)
	}
}

func BenchmarkLegacyOverride1MB(b *testing.B) {
	cfg := `{"temperature":0.2,"top_p":null}`
	plan, err := ParseAndCompile(&cfg, ScopeChannel)
	if err != nil {
		b.Fatal(err)
	}
	body := []byte(`{"temperature":1,"blob":"` + stringsRepeat("a", 1024*1024) + `"}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = Apply(Input{Body: append([]byte(nil), body...)}, plan)
	}
}

func BenchmarkRewriteTenOps1MB(b *testing.B) {
	cfg := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[
			{"id":"t","op":"set","path":"/temperature","value":0.2},
			{"id":"p","op":"set_if_absent","path":"/top_p","value":0.9},
			{"id":"h","op":"header_set","header":"X-Trace","value":"1"},
			{"id":"m","op":"copy","from":"/temperature","to":"/copied"},
			{"id":"d","op":"delete","path":"/drop"},
			{"id":"a","op":"array_append","path":"/tags","value":"z"},
			{"id":"l","op":"set","path":"/label","value_template":"model-${body:/model}"},
			{"id":"k","op":"header_set_if_absent","header":"X-Keep","value":"yes"},
			{"id":"n","op":"set","path":"/n","value":1},
			{"id":"o","op":"set","path":"/o","value":2}
		]
	}`
	plan, err := ParseAndCompile(&cfg, ScopeChannel)
	if err != nil {
		b.Fatal(err)
	}
	body := []byte(`{"model":"gpt","drop":true,"tags":["a"],"blob":"` + stringsRepeat("b", 1024*1024) + `"}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = Apply(Input{Body: append([]byte(nil), body...), Headers: http.Header{}}, plan)
	}
}

func BenchmarkRewriteArrayRemoveLargeTools(b *testing.B) {
	cfg := `{
		"$schema":"octopus.request-rewrite/v2",
		"operations":[{"id":"rm","op":"array_remove","path":"/tools","item_when":{"source":"item","path":"/function/name","operator":"prefix","value":"internal_"}}]
	}`
	plan, err := ParseAndCompile(&cfg, ScopeChannel)
	if err != nil {
		b.Fatal(err)
	}
	tools := `{"function":{"name":"internal_one"}},{"function":{"name":"ok"}},{"function":{"name":"internal_two"}}`
	body := []byte(`{"tools":[` + stringsRepeat(tools+",", 200) + `{"function":{"name":"keep"}}]}`)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = Apply(Input{Body: append([]byte(nil), body...)}, plan)
	}
}

func stringsRepeat(s string, n int) string {
	b := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		b = append(b, s...)
	}
	return string(b)
}
