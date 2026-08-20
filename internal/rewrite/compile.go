package rewrite

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/http/httpguts"
)

func ValidateRawConfig(raw *string, scope Scope) (*ValidationResult, error) {
	plan, err := ParseAndCompile(raw, scope)
	if err != nil {
		return nil, err
	}
	out := &ValidationResult{Plan: plan}
	if plan != nil {
		out.Legacy = plan.Legacy
		if plan.Legacy {
			out.Warnings = append(out.Warnings, "legacy top-level override; saving converts to v2")
		}
		_ = WarmCache(raw, scope)
	}
	return out, nil
}

func ValidateRawConfigPtr(raw *string, scope Scope) error {
	_, err := ValidateRawConfig(raw, scope)
	return err
}

func ParseAndCompile(raw *string, scope Scope) (*Plan, error) {
	decoded, err := decodeRaw(raw)
	if err != nil {
		return nil, err
	}
	if decoded == nil || decoded.Config == nil {
		return nil, nil
	}
	return compileConfig(decoded.Config, scope, decoded.Legacy, decoded.RawHash)
}

func compileConfig(cfg *Config, scope Scope, legacy bool, hash string) (*Plan, error) {
	if cfg == nil {
		return nil, nil
	}
	if cfg.Schema != "" && cfg.Schema != SchemaV2 {
		return nil, validationError(fmt.Sprintf("unknown request rewrite schema %q", cfg.Schema))
	}
	if cfg.Schema == "" {
		cfg.Schema = SchemaV2
	}
	if cfg.Stage == "" {
		cfg.Stage = StageOutboundProvider
	}
	if cfg.Stage != StageOutboundProvider {
		return nil, validationError(fmt.Sprintf("unsupported stage %q", cfg.Stage))
	}
	if len(cfg.Operations) > MaxOperations {
		return nil, validationError(fmt.Sprintf("too many operations (max %d)", MaxOperations))
	}
	policy := cfg.Policy.WithDefaults()
	if err := validatePolicy(policy); err != nil {
		return nil, err
	}
	ids := make(map[string]struct{}, len(cfg.Operations))
	compiled := make([]compiledOp, 0, len(cfg.Operations))
	for i, op := range cfg.Operations {
		if strings.TrimSpace(op.ID) == "" {
			return nil, validationError(fmt.Sprintf("operation %d is missing id", i))
		}
		if _, dup := ids[op.ID]; dup {
			return nil, validationError(fmt.Sprintf("duplicate operation id %q", op.ID))
		}
		ids[op.ID] = struct{}{}
		cop, err := compileOperation(op, scope, policy, cfg.AllowSensitiveHeaders)
		if err != nil {
			return nil, err
		}
		compiled = append(compiled, cop)
	}
	return &Plan{
		Scope:                 scope,
		Stage:                 cfg.Stage,
		Enabled:               boolDefault(cfg.Enabled, true),
		Policy:                policy,
		AllowSensitiveHeaders: cfg.AllowSensitiveHeaders,
		Ops:                   compiled,
		Legacy:                legacy,
		Hash:                  hash,
	}, nil
}

type Plan struct {
	Scope                 Scope
	Stage                 Stage
	Enabled               bool
	Policy                Policy
	AllowSensitiveHeaders bool
	Ops                   []compiledOp
	Legacy                bool
	Hash                  string
}

type compiledOp struct {
	raw       Operation
	policy    Policy
	path      *parsedPath
	from      *parsedPath
	to        *parsedPath
	when      *compiledCondition
	itemWhen  *compiledCondition
	valueMode valueMode
	template  *compiledTemplate
	regex     *regexp.Regexp
}

type valueMode int

const (
	valueNone valueMode = iota
	valueLiteral
	valueFrom
	valueTemplate
)

func compileOperation(op Operation, scope Scope, parent Policy, allowSensitive bool) (compiledOp, error) {
	if !IsSupportedOp(op.Op) {
		return compiledOp{}, validationError(fmt.Sprintf("unsupported operation %q", op.Op))
	}
	policy := parent.Merge(op.Policy)
	if err := validatePolicy(policy); err != nil {
		return compiledOp{}, err
	}
	out := compiledOp{raw: op, policy: policy}
	var err error
	out.valueMode, err = classifyValue(op)
	if err != nil {
		return compiledOp{}, err
	}
	if op.ValueTemplate != nil {
		if len(*op.ValueTemplate) > MaxTemplateBytes {
			return compiledOp{}, validationError("value_template exceeds limit")
		}
		tpl, err := parseTemplate(*op.ValueTemplate)
		if err != nil {
			return compiledOp{}, err
		}
		out.template = tpl
	}
	if op.When != nil {
		cond, err := compileCondition(op.When, 0, 0)
		if err != nil {
			return compiledOp{}, err
		}
		out.when = cond
	}
	if op.ItemWhen != nil {
		cond, err := compileCondition(op.ItemWhen, 0, 0)
		if err != nil {
			return compiledOp{}, err
		}
		out.itemWhen = cond
	}
	switch op.Op {
	case OpSet, OpSetIfAbsent, OpDelete:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if op.Op != OpDelete && out.valueMode == valueNone {
			return compiledOp{}, validationError(fmt.Sprintf("operation %q requires a value", op.Op))
		}
		if op.Op == OpDelete && out.valueMode != valueNone {
			return compiledOp{}, validationError("delete does not take a value")
		}
		if err := forbidProtectedBody(op.Path); err != nil {
			return compiledOp{}, err
		}
	case OpMove, OpCopy:
		out.from, err = requireBodyPath(op.From, false)
		if err != nil {
			return compiledOp{}, err
		}
		out.to, err = requireBodyPath(op.To, false)
		if err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedBody(op.To); err != nil {
			return compiledOp{}, err
		}
		if op.Op == OpMove {
			if err := forbidProtectedBody(op.From); err != nil {
				return compiledOp{}, err
			}
		}
	case OpArrayAppend, OpArrayPrepend, OpArrayInsert:
		out.path, err = requireBodyPath(op.Path, true)
		if err != nil {
			return compiledOp{}, err
		}
		if out.valueMode == valueNone {
			return compiledOp{}, validationError(fmt.Sprintf("operation %q requires a value", op.Op))
		}
		if op.Op == OpArrayInsert && op.Index == nil {
			return compiledOp{}, validationError("array_insert requires index")
		}
	case OpArrayRemove:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if out.itemWhen == nil {
			return compiledOp{}, validationError("array_remove requires item_when")
		}
	case OpHeaderSet, OpHeaderSetIfAbsent, OpHeaderAdd, OpHeaderDelete:
		if err := validateHeaderName(op.Header); err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedHeader(op.Header); err != nil {
			return compiledOp{}, err
		}
		if err := forbidSensitiveHeader(op.Header, scope, allowSensitive); err != nil {
			return compiledOp{}, err
		}
		if op.Op != OpHeaderDelete && out.valueMode == valueNone {
			return compiledOp{}, validationError(fmt.Sprintf("operation %q requires a value", op.Op))
		}
	case OpHeaderCopy, OpHeaderMove:
		if err := validateHeaderName(op.FromHeader); err != nil {
			return compiledOp{}, err
		}
		if err := validateHeaderName(op.ToHeader); err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedHeader(op.ToHeader); err != nil {
			return compiledOp{}, err
		}
		if err := forbidSensitiveHeader(op.ToHeader, scope, allowSensitive); err != nil {
			return compiledOp{}, err
		}
		if op.Op == OpHeaderMove {
			if err := forbidProtectedHeader(op.FromHeader); err != nil {
				return compiledOp{}, err
			}
			if err := forbidSensitiveHeader(op.FromHeader, scope, allowSensitive); err != nil {
				return compiledOp{}, err
			}
		}
	case OpReturnError:
		if op.Error == nil || strings.TrimSpace(op.Error.Message) == "" {
			return compiledOp{}, validationError("return_error requires error.message")
		}
		retry := op.Error.Retry
		if retry == "" {
			retry = RetryStop
		}
		if retry != RetryStop && retry != RetryNextChannel {
			return compiledOp{}, validationError("return_error.retry must be stop or next_channel")
		}
		if retry == RetryNextChannel && scope != ScopeChannel {
			return compiledOp{}, validationError("retry=next_channel is only allowed on channel scope")
		}
	case OpTrimPrefix, OpTrimSuffix, OpEnsurePrefix, OpEnsureSuffix, OpTrimSpace, OpToLower, OpToUpper:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedBody(op.Path); err != nil {
			return compiledOp{}, err
		}
		needsValue := op.Op == OpTrimPrefix || op.Op == OpTrimSuffix || op.Op == OpEnsurePrefix || op.Op == OpEnsureSuffix
		if needsValue && out.valueMode == valueNone {
			return compiledOp{}, validationError(fmt.Sprintf("operation %q requires a value", op.Op))
		}
		if !needsValue && out.valueMode != valueNone {
			return compiledOp{}, validationError(fmt.Sprintf("operation %q does not take a value", op.Op))
		}
	case OpReplace:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedBody(op.Path); err != nil {
			return compiledOp{}, err
		}
		if strings.TrimSpace(op.Search) == "" && out.valueMode == valueNone {
			return compiledOp{}, validationError("replace requires search or value")
		}
	case OpRegexReplace:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedBody(op.Path); err != nil {
			return compiledOp{}, err
		}
		if strings.TrimSpace(op.Pattern) == "" {
			return compiledOp{}, validationError("regex_replace requires pattern")
		}
		if len(op.Pattern) > MaxRegexBytes {
			return compiledOp{}, validationError("regex pattern exceeds limit")
		}
		re, err := regexp.Compile(op.Pattern)
		if err != nil {
			return compiledOp{}, validationError("invalid regex pattern")
		}
		out.regex = re
	case OpPruneObjects:
		out.path, err = requireBodyPath(op.Path, false)
		if err != nil {
			return compiledOp{}, err
		}
		if out.itemWhen == nil {
			return compiledOp{}, validationError("prune_objects requires item_when")
		}
	case OpHeaderPass:
		if strings.TrimSpace(op.Pattern) != "" {
			if len(op.Pattern) > MaxRegexBytes {
				return compiledOp{}, validationError("regex pattern exceeds limit")
			}
			re, err := regexp.Compile(op.Pattern)
			if err != nil {
				return compiledOp{}, validationError("invalid regex pattern")
			}
			out.regex = re
		}
		if out.valueMode == valueNone && out.regex == nil {
			return compiledOp{}, validationError("header_pass requires value allowlist or pattern")
		}
	case OpSyncFields:
		out.path, err = requireBodyPath(op.Path, true)
		if err != nil {
			return compiledOp{}, err
		}
		if err := validateHeaderName(op.Header); err != nil {
			return compiledOp{}, err
		}
		if err := forbidProtectedHeader(op.Header); err != nil {
			return compiledOp{}, err
		}
		if err := forbidSensitiveHeader(op.Header, scope, allowSensitive); err != nil {
			return compiledOp{}, err
		}
	}
	return out, nil
}

func classifyValue(op Operation) (valueMode, error) {
	n := 0
	mode := valueNone
	if op.Value.Present {
		n++
		mode = valueLiteral
	}
	if op.ValueFrom != nil {
		n++
		mode = valueFrom
		if op.ValueFrom.Source == "" || op.ValueFrom.Path == "" {
			return valueNone, validationError("value_from requires source and path")
		}
	}
	if op.ValueTemplate != nil {
		n++
		mode = valueTemplate
	}
	if n > 1 {
		return valueNone, validationError("provide only one of value, value_from, value_template")
	}
	return mode, nil
}

func requireBodyPath(path string, allowAppend bool) (*parsedPath, error) {
	p, err := parseJSONPointer(path)
	if err != nil {
		return nil, validationError(err.Error())
	}
	if p.hasAppend() && !allowAppend {
		return nil, validationError("/- is only valid for array append/insert targets")
	}
	return p, nil
}

func validatePolicy(p Policy) error {
	switch p.OnError {
	case OnErrorReject, OnErrorWarnAndContinue:
	default:
		return validationError(fmt.Sprintf("invalid on_error %q", p.OnError))
	}
	switch p.OnMissing {
	case OnMissingSkip, OnMissingError:
	default:
		return validationError(fmt.Sprintf("invalid on_missing %q", p.OnMissing))
	}
	switch p.OnTypeMismatch {
	case OnTypeMismatchSkip, OnTypeMismatchError:
	default:
		return validationError(fmt.Sprintf("invalid on_type_mismatch %q", p.OnTypeMismatch))
	}
	switch p.OnConflict {
	case OnConflictOverwrite, OnConflictKeep, OnConflictError:
	default:
		return validationError(fmt.Sprintf("invalid on_conflict %q", p.OnConflict))
	}
	return nil
}

var protectedBodyExact = map[string]struct{}{
	"/stream": {},
}

var protectedBodyWS = map[string]struct{}{
	"/type":       {},
	"/background": {},
}

func forbidProtectedBody(path string) error {
	if _, ok := protectedBodyExact[path]; ok {
		return validationError(fmt.Sprintf("path %s is protected", path))
	}
	if _, ok := protectedBodyWS[path]; ok {
		return validationError(fmt.Sprintf("path %s is protected in websocket transport", path))
	}
	return nil
}

func isProtectedBody(path string, transport Transport) bool {
	if _, ok := protectedBodyExact[path]; ok {
		return true
	}
	if transport == TransportWS {
		if _, ok := protectedBodyWS[path]; ok {
			return true
		}
	}
	return false
}

var forbiddenHeaders = map[string]struct{}{
	"host": {}, "content-length": {}, "transfer-encoding": {}, "connection": {},
	"proxy-connection": {}, "keep-alive": {}, "te": {}, "trailer": {}, "upgrade": {},
}

var sensitiveHeaders = map[string]struct{}{
	"authorization": {}, "proxy-authorization": {}, "x-api-key": {},
	"x-api-secret": {}, "x-api-token": {}, "cookie": {}, "set-cookie": {},
}

func canonicalHeader(name string) string {
	return http.CanonicalHeaderKey(strings.TrimSpace(name))
}

func validateHeaderName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return validationError("header name is required")
	}
	if !httpguts.ValidHeaderFieldName(name) {
		return validationError(fmt.Sprintf("invalid header name %q", name))
	}
	if strings.HasPrefix(strings.ToLower(name), "sec-websocket-") {
		return validationError("Sec-WebSocket-* headers are protected")
	}
	return nil
}

func validateHeaderValue(value string) error {
	if !utf8.ValidString(value) {
		return validationError("header value is not valid utf-8")
	}
	if !httpguts.ValidHeaderFieldValue(value) {
		return validationError("invalid header value")
	}
	return nil
}

func forbidProtectedHeader(name string) error {
	lower := strings.ToLower(name)
	if _, ok := forbiddenHeaders[lower]; ok {
		return validationError(fmt.Sprintf("header %s is protected", name))
	}
	if strings.HasPrefix(lower, "sec-websocket-") {
		return validationError("Sec-WebSocket-* headers are protected")
	}
	return nil
}

func forbidSensitiveHeader(name string, scope Scope, allow bool) error {
	lower := strings.ToLower(name)
	if _, ok := sensitiveHeaders[lower]; !ok {
		return nil
	}
	if scope == ScopeGroup {
		return validationError("group scope cannot write sensitive headers")
	}
	if !allow {
		return validationError("channel must set allow_sensitive_headers to write sensitive headers")
	}
	return nil
}

func isSensitiveHeader(name string) bool {
	_, ok := sensitiveHeaders[strings.ToLower(name)]
	return ok
}
