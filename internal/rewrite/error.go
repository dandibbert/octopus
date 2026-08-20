package rewrite

import (
	"fmt"
	"net/http"
)

type ErrorKind string

const (
	ErrorKindReturn       ErrorKind = "return_error"
	ErrorKindInvalidInput ErrorKind = "invalid_input"
	ErrorKindConfig       ErrorKind = "config"
	ErrorKindInternal     ErrorKind = "internal"
	ErrorKindMissing      ErrorKind = "missing"
	ErrorKindTypeMismatch ErrorKind = "type_mismatch"
	ErrorKindConflict     ErrorKind = "conflict"
	ErrorKindForbidden    ErrorKind = "forbidden"
	ErrorKindLimit        ErrorKind = "limit"
	ErrorKindUnsupported  ErrorKind = "unsupported"
)

type ApplyError struct {
	Kind             ErrorKind
	Scope            Scope
	OperationID      string
	PublicMessage    string
	InternalMessage  string
	StatusCode       int
	Code             string
	Type             string
	RetryDisposition RetryDisposition
}

func (e *ApplyError) Error() string {
	if e == nil {
		return ""
	}
	if e.InternalMessage != "" {
		return e.InternalMessage
	}
	return e.PublicMessage
}

func (e *ApplyError) WithScope(scope Scope, opID string) *ApplyError {
	if e == nil {
		return nil
	}
	clone := *e
	clone.Scope = scope
	clone.OperationID = opID
	return &clone
}

func validationError(msg string) error {
	return fmt.Errorf("%s", msg)
}

func newReturnError(spec ReturnErrorSpec) *ApplyError {
	status := spec.Status
	if status == 0 {
		status = http.StatusBadRequest
	}
	code := spec.Code
	if code == "" {
		code = "request_rewrite_blocked"
	}
	typ := spec.Type
	if typ == "" {
		typ = "invalid_request_error"
	}
	retry := spec.Retry
	if retry == "" {
		retry = RetryStop
	}
	return &ApplyError{
		Kind:             ErrorKindReturn,
		PublicMessage:    spec.Message,
		InternalMessage:  spec.Message,
		StatusCode:       status,
		Code:             code,
		Type:             typ,
		RetryDisposition: retry,
	}
}

func newInvalidInput(msg string) *ApplyError {
	return &ApplyError{
		Kind:             ErrorKindInvalidInput,
		PublicMessage:    msg,
		InternalMessage:  msg,
		StatusCode:       http.StatusBadRequest,
		Code:             "request_rewrite_invalid_input",
		Type:             "invalid_request_error",
		RetryDisposition: RetryStop,
	}
}

func ConfigCompileError(err error) *ApplyError {
	if err == nil {
		return nil
	}
	if ae, ok := err.(*ApplyError); ok {
		return ae
	}
	return newConfigError(err.Error())
}

func newConfigError(msg string) *ApplyError {
	return &ApplyError{
		Kind:             ErrorKindConfig,
		PublicMessage:    "request rewrite configuration is invalid",
		InternalMessage:  msg,
		StatusCode:       http.StatusInternalServerError,
		Code:             "request_rewrite_config_error",
		Type:             "api_error",
		RetryDisposition: RetryStop,
	}
}

func newInternalError(msg string) *ApplyError {
	return &ApplyError{
		Kind:             ErrorKindInternal,
		PublicMessage:    "request rewrite failed",
		InternalMessage:  msg,
		StatusCode:       http.StatusInternalServerError,
		Code:             "request_rewrite_internal_error",
		Type:             "api_error",
		RetryDisposition: RetryStop,
	}
}

func mapPolicyError(kind ErrorKind, policy Policy, msg string) *ApplyError {
	switch kind {
	case ErrorKindMissing:
		if policy.OnMissing == OnMissingSkip {
			return nil
		}
	case ErrorKindTypeMismatch:
		if policy.OnTypeMismatch == OnTypeMismatchSkip {
			return nil
		}
	case ErrorKindConflict:
		if policy.OnConflict != OnConflictError {
			return nil
		}
	}
	if policy.OnError == OnErrorWarnAndContinue && kind != ErrorKindReturn {
		return nil
	}
	status := http.StatusBadRequest
	code := "request_rewrite_invalid_input"
	if kind == ErrorKindInternal || kind == ErrorKindConfig {
		status = http.StatusInternalServerError
		code = "request_rewrite_internal_error"
		if kind == ErrorKindConfig {
			code = "request_rewrite_config_error"
		}
	}
	return &ApplyError{
		Kind:             kind,
		PublicMessage:    msg,
		InternalMessage:  msg,
		StatusCode:       status,
		Code:             code,
		Type:             "invalid_request_error",
		RetryDisposition: RetryStop,
	}
}
