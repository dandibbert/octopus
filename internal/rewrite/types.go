package rewrite

import (
	"encoding/json"
	"net/http"
)

const SchemaV2 = "octopus.request-rewrite/v2"

type Stage string

const StageOutboundProvider Stage = "outbound_provider"

type Scope string

const (
	ScopeGroup   Scope = "group"
	ScopeChannel Scope = "channel"
)

type Transport string

const (
	TransportHTTP Transport = "http"
	TransportWS   Transport = "websocket"
)

type OpType string

const (
	OpSet               OpType = "set"
	OpSetIfAbsent       OpType = "set_if_absent"
	OpDelete            OpType = "delete"
	OpMove              OpType = "move"
	OpCopy              OpType = "copy"
	OpArrayAppend       OpType = "array_append"
	OpArrayPrepend      OpType = "array_prepend"
	OpArrayInsert       OpType = "array_insert"
	OpArrayRemove       OpType = "array_remove"
	OpHeaderSet         OpType = "header_set"
	OpHeaderSetIfAbsent OpType = "header_set_if_absent"
	OpHeaderAdd         OpType = "header_add"
	OpHeaderDelete      OpType = "header_delete"
	OpHeaderCopy        OpType = "header_copy"
	OpHeaderMove        OpType = "header_move"
	OpReturnError       OpType = "return_error"
	OpTrimPrefix        OpType = "trim_prefix"
	OpTrimSuffix        OpType = "trim_suffix"
	OpEnsurePrefix      OpType = "ensure_prefix"
	OpEnsureSuffix      OpType = "ensure_suffix"
	OpTrimSpace         OpType = "trim_space"
	OpToLower           OpType = "to_lower"
	OpToUpper           OpType = "to_upper"
	OpReplace           OpType = "replace"
	OpRegexReplace      OpType = "regex_replace"
	OpPruneObjects      OpType = "prune_objects"
	OpHeaderPass        OpType = "header_pass"
	OpSyncFields        OpType = "sync_fields"
)

var p0Ops = map[OpType]struct{}{
	OpSet: {}, OpSetIfAbsent: {}, OpDelete: {}, OpMove: {}, OpCopy: {},
	OpArrayAppend: {}, OpArrayPrepend: {}, OpArrayInsert: {}, OpArrayRemove: {},
	OpHeaderSet: {}, OpHeaderSetIfAbsent: {}, OpHeaderAdd: {}, OpHeaderDelete: {},
	OpHeaderCopy: {}, OpHeaderMove: {}, OpReturnError: {},
}

var p1Ops = map[OpType]struct{}{
	OpTrimPrefix: {}, OpTrimSuffix: {}, OpEnsurePrefix: {}, OpEnsureSuffix: {},
	OpTrimSpace: {}, OpToLower: {}, OpToUpper: {}, OpReplace: {}, OpRegexReplace: {},
	OpPruneObjects: {}, OpHeaderPass: {}, OpSyncFields: {},
}

func IsP0Op(op OpType) bool {
	_, ok := p0Ops[op]
	return ok
}

func IsSupportedOp(op OpType) bool {
	if IsP0Op(op) {
		return true
	}
	_, ok := p1Ops[op]
	return ok
}

type OnErrorPolicy string

const (
	OnErrorReject          OnErrorPolicy = "reject"
	OnErrorWarnAndContinue OnErrorPolicy = "warn_and_continue"
)

type OnMissingPolicy string

const (
	OnMissingSkip  OnMissingPolicy = "skip"
	OnMissingError OnMissingPolicy = "error"
)

type OnTypeMismatchPolicy string

const (
	OnTypeMismatchSkip  OnTypeMismatchPolicy = "skip"
	OnTypeMismatchError OnTypeMismatchPolicy = "error"
)

type OnConflictPolicy string

const (
	OnConflictOverwrite OnConflictPolicy = "overwrite"
	OnConflictKeep      OnConflictPolicy = "keep"
	OnConflictError     OnConflictPolicy = "error"
)

type ValueSourceType string

const (
	ValueSourceBody    ValueSourceType = "body"
	ValueSourceHeader  ValueSourceType = "header"
	ValueSourceContext ValueSourceType = "context"
	ValueSourceItem    ValueSourceType = "item"
)

type ConditionSource = ValueSourceType

type Operator string

const (
	OpExists   Operator = "exists"
	OpMissing  Operator = "missing"
	OpEq       Operator = "eq"
	OpNeq      Operator = "neq"
	OpPrefix   Operator = "prefix"
	OpSuffix   Operator = "suffix"
	OpContains Operator = "contains"
	OpRegex    Operator = "regex"
	OpGT       Operator = "gt"
	OpGTE      Operator = "gte"
	OpLT       Operator = "lt"
	OpLTE      Operator = "lte"
	OpIn       Operator = "in"
	OpNotIn    Operator = "not_in"
	OpTypeIs   Operator = "type_is"
	OpNoneEq   Operator = "none_eq"
)

type RetryDisposition string

const (
	RetryStop        RetryDisposition = "stop"
	RetryNextChannel RetryDisposition = "next_channel"
)

type Config struct {
	Schema                string      `json:"$schema"`
	Stage                 Stage       `json:"stage"`
	Enabled               *bool       `json:"enabled,omitempty"`
	Policy                Policy      `json:"policy,omitempty"`
	AllowSensitiveHeaders bool        `json:"allow_sensitive_headers,omitempty"`
	Operations            []Operation `json:"operations"`
}

type Operation struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Enabled *bool  `json:"enabled,omitempty"`
	Op      OpType `json:"op"`

	Path string `json:"path,omitempty"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`

	Header     string `json:"header,omitempty"`
	FromHeader string `json:"from_header,omitempty"`
	ToHeader   string `json:"to_header,omitempty"`

	Value         OptionalRawValue `json:"value,omitempty"`
	ValueFrom     *ValueSource     `json:"value_from,omitempty"`
	ValueTemplate *string          `json:"value_template,omitempty"`

	When     *ConditionExpr `json:"when,omitempty"`
	ItemWhen *ConditionExpr `json:"item_when,omitempty"`
	Policy   Policy         `json:"policy,omitempty"`

	Index       *int   `json:"index,omitempty"`
	Splat       *bool  `json:"splat,omitempty"`
	Recursive   *bool  `json:"recursive,omitempty"`
	Search      string `json:"search,omitempty"`
	Pattern     string `json:"pattern,omitempty"`
	Replacement string `json:"replacement,omitempty"`

	Error *ReturnErrorSpec `json:"error,omitempty"`
}

type Policy struct {
	OnError        OnErrorPolicy        `json:"on_error,omitempty"`
	OnMissing      OnMissingPolicy      `json:"on_missing,omitempty"`
	OnTypeMismatch OnTypeMismatchPolicy `json:"on_type_mismatch,omitempty"`
	OnConflict     OnConflictPolicy     `json:"on_conflict,omitempty"`
}

func DefaultPolicy() Policy {
	return Policy{
		OnError:        OnErrorReject,
		OnMissing:      OnMissingSkip,
		OnTypeMismatch: OnTypeMismatchError,
		OnConflict:     OnConflictOverwrite,
	}
}

func (p Policy) WithDefaults() Policy {
	d := DefaultPolicy()
	if p.OnError != "" {
		d.OnError = p.OnError
	}
	if p.OnMissing != "" {
		d.OnMissing = p.OnMissing
	}
	if p.OnTypeMismatch != "" {
		d.OnTypeMismatch = p.OnTypeMismatch
	}
	if p.OnConflict != "" {
		d.OnConflict = p.OnConflict
	}
	return d
}

func (p Policy) Merge(over Policy) Policy {
	out := p.WithDefaults()
	if over.OnError != "" {
		out.OnError = over.OnError
	}
	if over.OnMissing != "" {
		out.OnMissing = over.OnMissing
	}
	if over.OnTypeMismatch != "" {
		out.OnTypeMismatch = over.OnTypeMismatch
	}
	if over.OnConflict != "" {
		out.OnConflict = over.OnConflict
	}
	return out
}

type ValueSource struct {
	Source  ValueSourceType  `json:"source"`
	Path    string           `json:"path"`
	Default OptionalRawValue `json:"default,omitempty"`
}

type ConditionExpr struct {
	All           []ConditionExpr  `json:"all,omitempty"`
	Any           []ConditionExpr  `json:"any,omitempty"`
	Not           *ConditionExpr   `json:"not,omitempty"`
	Source        ConditionSource  `json:"source,omitempty"`
	Path          string           `json:"path,omitempty"`
	Operator      Operator         `json:"operator,omitempty"`
	Value         OptionalRawValue `json:"value,omitempty"`
	CaseSensitive *bool            `json:"case_sensitive,omitempty"`
}

type conditionKind int

const (
	conditionInvalid conditionKind = iota
	conditionAll
	conditionAny
	conditionNot
	conditionPredicate
)

func (c *ConditionExpr) kind() conditionKind {
	if c == nil {
		return conditionInvalid
	}
	n := 0
	var k conditionKind
	if len(c.All) > 0 {
		n++
		k = conditionAll
	}
	if len(c.Any) > 0 {
		n++
		k = conditionAny
	}
	if c.Not != nil {
		n++
		k = conditionNot
	}
	leaf := c.Source != "" || c.Path != "" || c.Operator != "" || c.Value.Present || c.CaseSensitive != nil
	if leaf {
		n++
		k = conditionPredicate
	}
	if n != 1 {
		return conditionInvalid
	}
	return k
}

type ReturnErrorSpec struct {
	Status  int              `json:"status,omitempty"`
	Code    string           `json:"code,omitempty"`
	Type    string           `json:"type,omitempty"`
	Message string           `json:"message"`
	Retry   RetryDisposition `json:"retry,omitempty"`
}

type Input struct {
	Body           []byte
	Headers        http.Header
	InboundHeaders http.Header
	Context        Context
	Transport      Transport
}

type Result struct {
	Body       []byte
	Headers    http.Header
	Trace      []TraceEntry
	Changed    bool
	ConfigHash []string
	Summary    Summary
}

type Summary struct {
	GroupConfigHash   string `json:"group_config_hash,omitempty"`
	ChannelConfigHash string `json:"channel_config_hash,omitempty"`
	Applied           int    `json:"applied"`
	Skipped           int    `json:"skipped"`
	Errors            int    `json:"errors"`
	TransportModel    string `json:"transport_model,omitempty"`
}

type TraceStatus string

const (
	TraceApplied          TraceStatus = "applied"
	TraceNoChange         TraceStatus = "no_change"
	TraceSkippedDisabled  TraceStatus = "skipped_disabled"
	TraceSkippedCondition TraceStatus = "skipped_condition"
	TraceSkippedMissing   TraceStatus = "skipped_missing"
	TraceSkippedPolicy    TraceStatus = "skipped_policy"
	TraceBlocked          TraceStatus = "blocked"
	TraceError            TraceStatus = "error"
)

type TraceEntry struct {
	Index       int         `json:"index"`
	Scope       Scope       `json:"scope"`
	OperationID string      `json:"operation_id"`
	Operation   OpType      `json:"operation"`
	Status      TraceStatus `json:"status"`
	Matched     bool        `json:"matched"`
	Changed     bool        `json:"changed"`
	Paths       []string    `json:"paths,omitempty"`
	Warning     string      `json:"warning,omitempty"`
	ErrorKind   string      `json:"error_kind,omitempty"`
	DurationUS  int64       `json:"duration_us"`
}

type ValidationResult struct {
	Plan     *Plan
	Warnings []string
	Legacy   bool
}

type jsonKind string

const (
	kindNull   jsonKind = "null"
	kindBool   jsonKind = "boolean"
	kindNumber jsonKind = "number"
	kindString jsonKind = "string"
	kindObject jsonKind = "object"
	kindArray  jsonKind = "array"
)

func boolDefault(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}

func compactJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var buf []byte
	buf = append(buf, raw...)
	return string(buf)
}
