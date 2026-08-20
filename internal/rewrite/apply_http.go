package rewrite

import (
	"bytes"
	"io"
	"net/http"
)

func ApplyToRequest(req *http.Request, transport Transport, ctx Context, inbound http.Header, plans ...*Plan) (*Result, error) {
	if req == nil {
		return &Result{}, nil
	}
	active := false
	for _, plan := range plans {
		if plan != nil && plan.Enabled && len(plan.Ops) > 0 {
			active = true
			break
		}
	}
	if !active {
		return &Result{Body: nil, Headers: req.Header}, nil
	}
	var body []byte
	if req.Body != nil {
		raw, err := io.ReadAll(req.Body)
		if err != nil {
			return nil, err
		}
		body = raw
	}
	result, err := Apply(Input{
		Body:           body,
		Headers:        req.Header,
		InboundHeaders: inbound,
		Context:        ctx,
		Transport:      transport,
	}, plans...)
	if err != nil && !result.Changed {
		restoreRequestBody(req, body)
		return &result, err
	}
	writeRequestBody(req, result.Body)
	req.Header = result.Headers
	return &result, err
}

func writeRequestBody(req *http.Request, body []byte) {
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
}

func restoreRequestBody(req *http.Request, body []byte) {
	if body == nil {
		return
	}
	writeRequestBody(req, body)
}
