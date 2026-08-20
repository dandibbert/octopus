package helper

import (
	"net/http"

	"github.com/bestruirui/octopus/internal/rewrite"
)

// ApplyParamOverrides compiles each override as a rewrite plan and applies them
// left-to-right. Later scopes win. Legacy top-level JSON objects still compile
// to set/delete operations. Prefer relay.prepareOutboundRequest for production
// HTTP/WS paths so header rewrite and transport invariants stay consistent.
//
// Deprecated: use rewrite.ParseAndCompile + rewrite.Apply.
func ApplyParamOverrides(request *http.Request, paramOverrides ...*string) error {
	if request == nil || len(paramOverrides) == 0 {
		return nil
	}
	plans := make([]*rewrite.Plan, 0, len(paramOverrides))
	for i, raw := range paramOverrides {
		scope := rewrite.ScopeChannel
		if len(paramOverrides) > 1 && i == 0 {
			scope = rewrite.ScopeGroup
		}
		plan, err := rewrite.ParseAndCompile(raw, scope)
		if err != nil {
			return err
		}
		if plan != nil {
			plans = append(plans, plan)
		}
	}
	if len(plans) == 0 {
		return nil
	}
	_, err := rewrite.ApplyToRequest(request, rewrite.TransportHTTP, rewrite.Context{}, nil, plans...)
	return err
}

// ApplyParamOverride keeps the legacy single-scope API for callers outside relay.
func ApplyParamOverride(request *http.Request, paramOverride *string) error {
	return ApplyParamOverrides(request, paramOverride)
}
