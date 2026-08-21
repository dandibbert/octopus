package rewrite

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"

	"github.com/tidwall/gjson"
)

type compiledCondition struct {
	kind          conditionKind
	all           []*compiledCondition
	any           []*compiledCondition
	not           *compiledCondition
	source        ConditionSource
	path          string
	bodyPath      *parsedPath
	operator      Operator
	value         OptionalRawValue
	caseSensitive bool
	regex         *regexp.Regexp
}

func compileCondition(expr *ConditionExpr) (*compiledCondition, error) {
	nodes := 0
	return compileConditionNode(expr, 0, &nodes)
}

func compileConditionNode(expr *ConditionExpr, depth int, nodes *int) (*compiledCondition, error) {
	if expr == nil {
		return nil, validationError("condition is required")
	}
	if depth > MaxConditionDepth {
		return nil, validationError("condition nesting exceeds limit")
	}
	*nodes = *nodes + 1
	if *nodes > MaxConditionNodes {
		return nil, validationError("too many condition nodes")
	}
	kind := expr.kind()
	if kind == conditionInvalid {
		return nil, validationError("condition must be exactly one of all, any, not, or a predicate")
	}
	out := &compiledCondition{kind: kind}
	switch kind {
	case conditionAll:
		if len(expr.All) == 0 {
			return nil, validationError("all requires at least one child")
		}
		for i := range expr.All {
			child, err := compileConditionNode(&expr.All[i], depth+1, nodes)
			if err != nil {
				return nil, err
			}
			out.all = append(out.all, child)
		}
	case conditionAny:
		if len(expr.Any) == 0 {
			return nil, validationError("any requires at least one child")
		}
		for i := range expr.Any {
			child, err := compileConditionNode(&expr.Any[i], depth+1, nodes)
			if err != nil {
				return nil, err
			}
			out.any = append(out.any, child)
		}
	case conditionNot:
		child, err := compileConditionNode(expr.Not, depth+1, nodes)
		if err != nil {
			return nil, err
		}
		out.not = child
	case conditionPredicate:
		if err := compilePredicate(expr, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func compilePredicate(expr *ConditionExpr, out *compiledCondition) error {
	if expr.Source == "" || expr.Operator == "" {
		return validationError("predicate requires source and operator")
	}
	switch expr.Source {
	case ValueSourceBody, ValueSourceHeader, ValueSourceContext, ValueSourceItem:
	default:
		return validationError(fmt.Sprintf("unsupported condition source %q", expr.Source))
	}
	switch expr.Operator {
	case OpExists, OpMissing, OpEq, OpNeq, OpPrefix, OpSuffix, OpContains, OpRegex,
		OpGT, OpGTE, OpLT, OpLTE, OpIn, OpNotIn, OpTypeIs:
	default:
		return validationError(fmt.Sprintf("unsupported operator %q", expr.Operator))
	}
	out.source = expr.Source
	out.path = expr.Path
	out.operator = expr.Operator
	out.value = expr.Value
	out.caseSensitive = boolDefault(expr.CaseSensitive, true)
	needsPath := expr.Source != ValueSourceHeader || expr.Path != ""
	if expr.Source == ValueSourceHeader && expr.Path == "" {
		return validationError("header condition requires path")
	}
	if expr.Source == ValueSourceHeader {
		if err := validateHeaderName(expr.Path); err != nil {
			return err
		}
		if isSensitiveHeader(expr.Path) {
			return validationError("conditions cannot read sensitive headers")
		}
	}
	if expr.Source == ValueSourceBody || expr.Source == ValueSourceItem {
		if expr.Path == "" {
			return validationError("body/item condition requires path")
		}
		p, err := parseJSONPointer(expr.Path)
		if err != nil {
			return validationError(err.Error())
		}
		out.bodyPath = p
	}
	if expr.Source == ValueSourceContext {
		if expr.Path == "" {
			return validationError("context condition requires path")
		}
		if _, _, err := (Context{}).Lookup(expr.Path); err != nil && !strings.HasPrefix(expr.Path, "request.metadata.") {
			return validationError(err.Error())
		}
	}
	_ = needsPath
	if expr.Operator == OpRegex {
		if !expr.Value.Present || expr.Value.Kind != kindString {
			return validationError("regex operator requires a string value")
		}
		if len(expr.Value.Raw) > MaxRegexBytes {
			return validationError("regex exceeds limit")
		}
		pattern, err := decodeJSONString(expr.Value.Raw)
		if err != nil {
			return err
		}
		if !out.caseSensitive {
			pattern = "(?i:" + pattern + ")"
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return validationError(fmt.Sprintf("invalid regex: %v", err))
		}
		out.regex = re
	}
	if expr.Operator == OpExists || expr.Operator == OpMissing {
		if expr.Value.Present {
			return validationError("exists/missing do not take a value")
		}
		return nil
	}
	if !expr.Value.Present {
		return validationError(fmt.Sprintf("operator %q requires a value", expr.Operator))
	}
	switch expr.Operator {
	case OpPrefix, OpSuffix, OpContains, OpRegex:
		if expr.Value.Kind != kindString {
			return validationError(fmt.Sprintf("operator %q requires a string value", expr.Operator))
		}
	case OpGT, OpGTE, OpLT, OpLTE:
		if expr.Value.Kind != kindNumber {
			return validationError(fmt.Sprintf("operator %q requires a numeric value", expr.Operator))
		}
	case OpIn, OpNotIn:
		if expr.Value.Kind != kindArray {
			return validationError(fmt.Sprintf("operator %q requires an array value", expr.Operator))
		}
	case OpTypeIs:
		if expr.Value.Kind != kindString {
			return validationError("type_is requires a string value")
		}
		want, err := decodeJSONString(expr.Value.Raw)
		if err != nil {
			return err
		}
		switch jsonKind(want) {
		case kindNull, kindBool, kindNumber, kindString, kindObject, kindArray:
		default:
			return validationError("type_is value must be null, boolean, number, string, object, or array")
		}
	}
	return nil
}

type evalState struct {
	body    []byte
	headers http.Header
	inbound http.Header
	ctx     Context
	item    []byte
}

func (c *compiledCondition) eval(state evalState) (bool, error) {
	if c == nil {
		return true, nil
	}
	switch c.kind {
	case conditionAll:
		for _, child := range c.all {
			ok, err := child.eval(state)
			if err != nil || !ok {
				return ok, err
			}
		}
		return true, nil
	case conditionAny:
		for _, child := range c.any {
			ok, err := child.eval(state)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil
	case conditionNot:
		ok, err := c.not.eval(state)
		if err != nil {
			return false, err
		}
		return !ok, nil
	case conditionPredicate:
		return c.evalPredicate(state)
	default:
		return false, fmt.Errorf("invalid condition")
	}
}

func (c *compiledCondition) evalPredicate(state evalState) (bool, error) {
	val, exists, isNull, err := c.read(state)
	if err != nil {
		if c.operator == OpMissing {
			return true, nil
		}
		if c.operator == OpExists {
			return false, nil
		}
		return false, nil
	}
	switch c.operator {
	case OpExists:
		return exists, nil
	case OpMissing:
		return !exists, nil
	}
	if !exists {
		return false, nil
	}
	switch c.operator {
	case OpEq:
		return jsonEqualWithCase(val, c.value.Raw, c.caseSensitive), nil
	case OpNeq:
		return !jsonEqualWithCase(val, c.value.Raw, c.caseSensitive), nil
	case OpPrefix, OpSuffix, OpContains:
		left, err := asString(val)
		if err != nil {
			return false, nil
		}
		right, err := decodeJSONString(c.value.Raw)
		if err != nil {
			return false, nil
		}
		if !c.caseSensitive {
			left = strings.ToLower(left)
			right = strings.ToLower(right)
		}
		switch c.operator {
		case OpPrefix:
			return strings.HasPrefix(left, right), nil
		case OpSuffix:
			return strings.HasSuffix(left, right), nil
		default:
			return strings.Contains(left, right), nil
		}
	case OpRegex:
		left, err := asString(val)
		if err != nil {
			return false, nil
		}
		return c.regex.MatchString(left), nil
	case OpGT, OpGTE, OpLT, OpLTE:
		cmp, ok := compareNumbers(val, c.value.Raw)
		if !ok {
			return false, nil
		}
		switch c.operator {
		case OpGT:
			return cmp > 0, nil
		case OpGTE:
			return cmp >= 0, nil
		case OpLT:
			return cmp < 0, nil
		default:
			return cmp <= 0, nil
		}
	case OpIn, OpNotIn:
		ok := jsonIn(val, c.value.Raw, c.caseSensitive)
		if c.operator == OpNotIn {
			return !ok, nil
		}
		return ok, nil
	case OpTypeIs:
		want, err := decodeJSONString(c.value.Raw)
		if err != nil {
			return false, nil
		}
		return string(detectKindOrEmpty(val)) == want, nil
	}
	_ = isNull
	return false, nil
}

func (c *compiledCondition) read(state evalState) (raw []byte, exists bool, isNull bool, err error) {
	switch c.source {
	case ValueSourceBody:
		if c.bodyPath == nil {
			return nil, false, false, nil
		}
		resolved, err := resolvePaths(state.body, c.bodyPath, false)
		if err != nil || len(resolved) == 0 {
			return nil, false, false, nil
		}
		return getRaw(state.body, resolved[0].gjson)
	case ValueSourceItem:
		if c.bodyPath == nil || len(state.item) == 0 {
			return nil, false, false, nil
		}
		resolved, err := resolvePaths(state.item, c.bodyPath, false)
		if err != nil || len(resolved) == 0 {
			return nil, false, false, nil
		}
		return getRaw(state.item, resolved[0].gjson)
	case ValueSourceHeader:
		if state.headers == nil {
			return nil, false, false, nil
		}
		values := state.headers.Values(c.path)
		if len(values) == 0 {
			return nil, false, false, nil
		}
		return encodeJSONString(values[0]), true, false, nil
	case ValueSourceContext:
		v, ok, err := state.ctx.Lookup(c.path)
		if err != nil || !ok {
			return nil, false, false, nil
		}
		return v.Raw, true, v.IsNull(), nil
	default:
		return nil, false, false, fmt.Errorf("unknown source")
	}
}

func decodeJSONString(raw json.RawMessage) (string, error) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", validationError("expected JSON string")
	}
	return s, nil
}

func asString(raw []byte) (string, error) {
	kind, _ := detectJSONKind(raw)
	if kind != kindString {
		return "", fmt.Errorf("not a string")
	}
	return decodeJSONString(raw)
}

func detectKindOrEmpty(raw []byte) jsonKind {
	k, err := detectJSONKind(raw)
	if err != nil {
		return ""
	}
	return k
}

func jsonEqual(a, b []byte) bool {
	if bytes.Equal(bytes.TrimSpace(a), bytes.TrimSpace(b)) {
		return true
	}
	ka, _ := detectJSONKind(a)
	kb, _ := detectJSONKind(b)
	if ka != kb {
		return false
	}
	if ka == kindNumber {
		cmp, ok := compareNumbers(a, b)
		return ok && cmp == 0
	}
	va, errA := decodeJSONUseNumber(a)
	vb, errB := decodeJSONUseNumber(b)
	if errA != nil || errB != nil {
		return false
	}
	aa, _ := json.Marshal(va)
	bb, _ := json.Marshal(vb)
	return bytes.Equal(aa, bb)
}

func jsonEqualWithCase(a, b []byte, caseSensitive bool) bool {
	if caseSensitive {
		return jsonEqual(a, b)
	}
	ka, _ := detectJSONKind(a)
	kb, _ := detectJSONKind(b)
	if ka == kindString && kb == kindString {
		left, errA := decodeJSONString(a)
		right, errB := decodeJSONString(b)
		return errA == nil && errB == nil && strings.EqualFold(left, right)
	}
	return jsonEqual(a, b)
}

func decodeJSONUseNumber(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func jsonIn(needle, haystack []byte, caseSensitive bool) bool {
	res := gjson.ParseBytes(haystack)
	if !res.IsArray() {
		return jsonEqualWithCase(needle, haystack, caseSensitive)
	}
	for _, item := range res.Array() {
		if jsonEqualWithCase(needle, []byte(item.Raw), caseSensitive) {
			return true
		}
	}
	return false
}

func compareNumbers(a, b []byte) (int, bool) {
	ra := new(big.Rat)
	rb := new(big.Rat)
	if _, ok := ra.SetString(strings.TrimSpace(string(a))); !ok {
		return 0, false
	}
	if _, ok := rb.SetString(strings.TrimSpace(string(b))); !ok {
		return 0, false
	}
	return ra.Cmp(rb), true
}
