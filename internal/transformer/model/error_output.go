package model

// ErrorOutputMode says whether the client-facing HTTP response has already
// been committed as a stream. This is independent of whether the original
// request asked for streaming.
type ErrorOutputMode int

const (
	// ErrorOutputHTTPJSON is used when HTTP status and Content-Type can still
	// be set. Adapters must emit a regular API error JSON body.
	ErrorOutputHTTPJSON ErrorOutputMode = iota
	// ErrorOutputCommittedStream is used after SSE headers (or an equivalent
	// stream prologue) have already been written. Adapters must emit a
	// protocol-legal terminal/error event.
	ErrorOutputCommittedStream
)
