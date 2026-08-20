package rewrite

import "net/http"

// EnforceHTTPTransportInvariants drops hop-by-hop headers after rewrite.
// HTTP requests without Content-Type default to application/json.
func EnforceHTTPTransportInvariants(req *http.Request, transport Transport) {
	if req == nil {
		return
	}
	req.Header.Del("Content-Length")
	req.Header.Del("Transfer-Encoding")
	req.Header.Del("Connection")
	req.Header.Del("Keep-Alive")
	req.Header.Del("TE")
	req.Header.Del("Trailer")
	req.Header.Del("Upgrade")
	if transport == TransportHTTP && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
}

// PrepareRequest applies rewrite then transport invariants.
// Custom headers must already be on req (same order as live relay copyHeaders).
func PrepareRequest(req *http.Request, transport Transport, ctx Context, inbound http.Header, plans ...*Plan) (*Result, error) {
	result, err := ApplyToRequest(req, transport, ctx, inbound, plans...)
	if req != nil {
		EnforceHTTPTransportInvariants(req, transport)
	}
	return result, err
}
