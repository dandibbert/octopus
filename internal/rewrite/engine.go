package rewrite

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tidwall/gjson"
)

func Apply(input Input, plans ...*Plan) (Result, error) {
	active := make([]*Plan, 0, len(plans))
	hashes := make([]string, 0, len(plans))
	for _, plan := range plans {
		if plan == nil || !plan.Enabled || len(plan.Ops) == 0 {
			continue
		}
		active = append(active, plan)
		if plan.Hash != "" {
			hashes = append(hashes, plan.Hash)
		}
	}
	if len(active) == 0 {
		return Result{
			Body:       input.Body,
			Headers:    cloneHeader(input.Headers),
			ConfigHash: hashes,
		}, nil
	}

	body := append([]byte(nil), input.Body...)
	headers := cloneHeader(input.Headers)
	state := evalState{body: body, headers: headers, inbound: cloneHeader(input.InboundHeaders), ctx: input.Context}
	trace := make([]TraceEntry, 0, 16)
	index := 0
	summary := Summary{}
	changed := false

	for _, plan := range active {
		if plan.Scope == ScopeGroup {
			summary.GroupConfigHash = plan.Hash
		}
		if plan.Scope == ScopeChannel {
			summary.ChannelConfigHash = plan.Hash
		}
		for i := range plan.Ops {
			op := &plan.Ops[i]
			start := time.Now()
			entry := TraceEntry{
				Index:       index,
				Scope:       plan.Scope,
				OperationID: op.raw.ID,
				Operation:   op.raw.Op,
			}
			index++
			if !boolDefault(op.raw.Enabled, true) {
				entry.Status = TraceSkippedDisabled
				summary.Skipped++
				trace = appendTrace(trace, entry, start)
				continue
			}
			if op.when != nil {
				ok, err := op.when.eval(state)
				if err != nil {
					return reject(plan, op, err, entry, start, body, headers, hashes, summary, trace)
				}
				if !ok {
					entry.Status = TraceSkippedCondition
					summary.Skipped++
					trace = appendTrace(trace, entry, start)
					continue
				}
			}
			entry.Matched = true
			applied, paths, warn, err := applyOp(op, plan, &state, input.Transport)
			entry.Paths = paths
			entry.Warning = warn
			if err != nil {
				applyErr, ok := err.(*ApplyError)
				if !ok {
					applyErr = mapRuntimeError(err, op.policy)
				}
				if applyErr == nil {
					entry.Status = TraceSkippedPolicy
					if warn == "" {
						entry.Warning = err.Error()
					}
					summary.Skipped++
					trace = appendTrace(trace, entry, start)
					continue
				}
				if applyErr.Kind == ErrorKindReturn {
					entry.Status = TraceBlocked
					summary.Errors++
					trace = appendTrace(trace, entry, start)
					return Result{Body: state.body, Headers: state.headers, Trace: trace, Changed: changed, ConfigHash: hashes, Summary: summary}, applyErr.WithScope(plan.Scope, op.raw.ID)
				}
				if op.policy.OnError == OnErrorWarnAndContinue {
					entry.Status = TraceError
					entry.Warning = applyErr.PublicMessage
					entry.ErrorKind = string(applyErr.Kind)
					summary.Errors++
					trace = appendTrace(trace, entry, start)
					continue
				}
				entry.Status = TraceError
				entry.ErrorKind = string(applyErr.Kind)
				summary.Errors++
				trace = appendTrace(trace, entry, start)
				return Result{Body: state.body, Headers: state.headers, Trace: trace, Changed: changed, ConfigHash: hashes, Summary: summary}, applyErr.WithScope(plan.Scope, op.raw.ID)
			}
			if applied {
				entry.Status = TraceApplied
				entry.Changed = true
				changed = true
				summary.Applied++
			} else {
				entry.Status = TraceNoChange
				summary.Skipped++
			}
			trace = appendTrace(trace, entry, start)
		}
	}

	if model := gjson.GetBytes(state.body, "model"); model.Exists() && model.Type == gjson.String {
		summary.TransportModel = model.String()
	}
	return Result{
		Body:       state.body,
		Headers:    state.headers,
		Trace:      trace,
		Changed:    changed,
		ConfigHash: hashes,
		Summary:    summary,
	}, nil
}

func reject(plan *Plan, op *compiledOp, err error, entry TraceEntry, start time.Time, body []byte, headers http.Header, hashes []string, summary Summary, trace []TraceEntry) (Result, error) {
	applyErr := mapRuntimeError(err, op.policy)
	if applyErr == nil {
		entry.Status = TraceSkippedPolicy
		entry.Warning = err.Error()
		summary.Skipped++
		return Result{Body: body, Headers: headers, Trace: appendTrace(trace, entry, start), ConfigHash: hashes, Summary: summary}, nil
	}
	entry.Status = TraceError
	entry.ErrorKind = string(applyErr.Kind)
	summary.Errors++
	return Result{Body: body, Headers: headers, Trace: appendTrace(trace, entry, start), ConfigHash: hashes, Summary: summary}, applyErr.WithScope(plan.Scope, op.raw.ID)
}

func appendTrace(trace []TraceEntry, entry TraceEntry, start time.Time) []TraceEntry {
	entry.DurationUS = time.Since(start).Microseconds()
	if len(trace) >= MaxTraceEntries {
		return trace
	}
	return append(trace, entry)
}

func applyOp(op *compiledOp, plan *Plan, state *evalState, transport Transport) (bool, []string, string, error) {
	switch op.raw.Op {
	case OpSet, OpSetIfAbsent:
		return applySet(op, plan, state, transport, op.raw.Op == OpSetIfAbsent)
	case OpDelete:
		return applyDelete(op, state, transport)
	case OpCopy:
		return applyCopyMove(op, state, transport, false)
	case OpMove:
		return applyCopyMove(op, state, transport, true)
	case OpArrayAppend, OpArrayPrepend, OpArrayInsert:
		return applyArrayInsert(op, state, transport)
	case OpArrayRemove:
		return applyArrayRemove(op, state, transport)
	case OpHeaderSet, OpHeaderSetIfAbsent, OpHeaderAdd:
		return applyHeaderWrite(op, state)
	case OpHeaderDelete:
		if !headerExists(state.headers, op.raw.Header) {
			if op.policy.OnMissing == OnMissingSkip {
				return false, nil, "", nil
			}
			return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "header is missing")
		}
		headerDelete(state.headers, op.raw.Header)
		return true, []string{op.raw.Header}, "", nil
	case OpHeaderCopy:
		if !headerExists(state.headers, op.raw.FromHeader) {
			if op.policy.OnMissing == OnMissingSkip {
				return false, nil, "", nil
			}
			return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "source header is missing")
		}
		if headerExists(state.headers, op.raw.ToHeader) && op.policy.OnConflict == OnConflictKeep {
			return false, nil, "", nil
		}
		if headerExists(state.headers, op.raw.ToHeader) && op.policy.OnConflict == OnConflictError {
			return false, nil, "", mapPolicyError(ErrorKindConflict, op.policy, "destination header exists")
		}
		headerCopy(state.headers, op.raw.FromHeader, op.raw.ToHeader)
		return true, []string{op.raw.FromHeader, op.raw.ToHeader}, "", nil
	case OpHeaderMove:
		if !headerExists(state.headers, op.raw.FromHeader) {
			if op.policy.OnMissing == OnMissingSkip {
				return false, nil, "", nil
			}
			return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "source header is missing")
		}
		if headerExists(state.headers, op.raw.ToHeader) && op.policy.OnConflict == OnConflictKeep {
			return false, nil, "", nil
		}
		if headerExists(state.headers, op.raw.ToHeader) && op.policy.OnConflict == OnConflictError {
			return false, nil, "", mapPolicyError(ErrorKindConflict, op.policy, "destination header exists")
		}
		headerMove(state.headers, op.raw.FromHeader, op.raw.ToHeader)
		return true, []string{op.raw.FromHeader, op.raw.ToHeader}, "", nil
	case OpReturnError:
		return false, nil, "", newReturnError(specFromOp(op))
	case OpTrimPrefix:
		return applyTrimPrefix(op, state, transport)
	case OpTrimSuffix:
		return applyTrimSuffix(op, state, transport)
	case OpEnsurePrefix:
		return applyEnsurePrefix(op, state, transport)
	case OpEnsureSuffix:
		return applyEnsureSuffix(op, state, transport)
	case OpTrimSpace:
		return applyTrimSpace(op, state, transport)
	case OpToLower:
		return applyToLower(op, state, transport)
	case OpToUpper:
		return applyToUpper(op, state, transport)
	case OpReplace:
		return applyReplace(op, state, transport)
	case OpRegexReplace:
		return applyRegexReplace(op, state, transport)
	case OpPruneObjects:
		return applyPruneObjects(op, state, transport)
	case OpHeaderPass:
		return applyHeaderPass(op, state)
	case OpSyncFields:
		return applySyncFields(op, state, transport)
	default:
		return false, nil, "", validationError(fmt.Sprintf("unsupported operation %q", op.raw.Op))
	}
}

func specFromOp(op *compiledOp) ReturnErrorSpec {
	spec := ReturnErrorSpec{Message: "request is not supported"}
	if op.raw.Error != nil {
		spec = *op.raw.Error
	}
	return spec
}

func applySet(op *compiledOp, plan *Plan, state *evalState, transport Transport, ifAbsent bool) (bool, []string, string, error) {
	_ = plan
	value, err := resolveValue(op, state)
	if err != nil {
		return false, nil, "", err
	}
	paths, err := resolvePaths(state.body, op.path, true)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(paths) == 0 {
		if op.policy.OnMissing == OnMissingSkip {
			return false, nil, "", nil
		}
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "path is missing")
	}
	changed := false
	touched := make([]string, 0, len(paths))
	for _, p := range paths {
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		exists := pathExists(state.body, p)
		if ifAbsent && exists {
			continue
		}
		if exists && op.policy.OnConflict == OnConflictKeep {
			continue
		}
		if exists && op.policy.OnConflict == OnConflictError {
			return false, nil, "", mapPolicyError(ErrorKindConflict, op.policy, "path already exists")
		}
		next, err := setRaw(state.body, p, value, true)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !compactEqual(next, state.body) {
			changed = true
		}
		state.body = next
		touched = append(touched, p.pointer)
	}
	return changed, touched, modelWarning(op), nil
}

func applyDelete(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	paths, err := resolvePaths(state.body, op.path, false)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(paths) == 0 {
		if op.policy.OnMissing == OnMissingSkip {
			return false, nil, "", nil
		}
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "path is missing")
	}
	changed := false
	touched := make([]string, 0, len(paths))
	for i := len(paths) - 1; i >= 0; i-- {
		p := paths[i]
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		if !pathExists(state.body, p) {
			continue
		}
		next, err := deletePath(state.body, p)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		state.body = next
		changed = true
		touched = append(touched, p.pointer)
	}
	return changed, touched, "", nil
}

func applyCopyMove(op *compiledOp, state *evalState, transport Transport, move bool) (bool, []string, string, error) {
	froms, err := resolvePaths(state.body, op.from, false)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(froms) == 0 {
		if op.policy.OnMissing == OnMissingSkip {
			return false, nil, "", nil
		}
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "source path is missing")
	}
	tos, err := resolvePaths(state.body, op.to, true)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(tos) == 0 {
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "destination path is missing")
	}
	changed := false
	touched := make([]string, 0)
	n := len(froms)
	if len(tos) < n {
		n = len(tos)
	}
	for i := 0; i < n; i++ {
		from, to := froms[i], tos[i]
		if isProtectedBody(to.pointer, transport) || (move && isProtectedBody(from.pointer, transport)) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field")
		}
		if pathExists(state.body, to) && op.policy.OnConflict == OnConflictKeep {
			continue
		}
		if pathExists(state.body, to) && op.policy.OnConflict == OnConflictError {
			return false, nil, "", mapPolicyError(ErrorKindConflict, op.policy, "destination exists")
		}
		var next []byte
		var ok bool
		if move {
			next, ok, err = movePath(state.body, from, to)
		} else {
			next, ok, err = copyPath(state.body, from, to)
		}
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !ok {
			continue
		}
		state.body = next
		changed = true
		touched = append(touched, from.pointer, to.pointer)
	}
	return changed, touched, modelWarning(op), nil
}

func applyArrayInsert(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	value, err := resolveValue(op, state)
	if err != nil {
		return false, nil, "", err
	}
	splat := true
	if op.raw.Splat != nil {
		splat = *op.raw.Splat
	}
	values := splatValues(value, splat)
	paths, err := resolvePaths(state.body, op.path, true)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(paths) == 0 {
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "array path is missing")
	}
	changed := false
	touched := make([]string, 0, len(paths))
	for _, p := range paths {
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		var next []byte
		switch op.raw.Op {
		case OpArrayAppend:
			next, err = arrayInsertValues(state.body, p, values, nil, false)
		case OpArrayPrepend:
			next, err = arrayInsertValues(state.body, p, values, nil, true)
		default:
			next, err = arrayInsertValues(state.body, p, values, op.raw.Index, false)
		}
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !compactEqual(next, state.body) {
			changed = true
		}
		state.body = next
		touched = append(touched, p.pointer)
	}
	return changed, touched, "", nil
}

func applyArrayRemove(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	paths, err := resolvePaths(state.body, op.path, false)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(paths) == 0 {
		return false, nil, "", nil
	}
	changed := false
	touched := make([]string, 0)
	for _, p := range paths {
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		next, removed, err := arrayRemoveMatching(state.body, p, op.itemWhen, *state)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if len(removed) == 0 {
			continue
		}
		state.body = next
		changed = true
		touched = append(touched, removed...)
	}
	return changed, touched, "", nil
}

func applyHeaderWrite(op *compiledOp, state *evalState) (bool, []string, string, error) {
	value, err := resolveValue(op, state)
	if err != nil {
		return false, nil, "", err
	}
	text, err := headerText(value)
	if err != nil {
		return false, nil, "", err
	}
	if err := validateHeaderValue(text); err != nil {
		return false, nil, "", err
	}
	exists := headerExists(state.headers, op.raw.Header)
	switch op.raw.Op {
	case OpHeaderSetIfAbsent:
		if exists {
			return false, nil, "", nil
		}
		headerSet(state.headers, op.raw.Header, text)
	case OpHeaderAdd:
		headerAdd(state.headers, op.raw.Header, text)
	default:
		if exists && op.policy.OnConflict == OnConflictKeep {
			return false, nil, "", nil
		}
		if exists && op.policy.OnConflict == OnConflictError {
			return false, nil, "", mapPolicyError(ErrorKindConflict, op.policy, "header already exists")
		}
		headerSet(state.headers, op.raw.Header, text)
	}
	return true, []string{op.raw.Header}, "", nil
}

func resolveValue(op *compiledOp, state *evalState) ([]byte, error) {
	var value []byte
	var err error
	switch op.valueMode {
	case valueLiteral:
		value = append([]byte(nil), op.raw.Value.Raw...)
	case valueFrom:
		value, err = resolveValueFrom(op.raw.ValueFrom, state, op.policy)
	case valueTemplate:
		var text string
		text, err = renderTemplate(op.template, state, op.policy)
		if err != nil {
			return nil, err
		}
		value = encodeJSONString(text)
	default:
		return nil, validationError("value is required")
	}
	if err != nil {
		return nil, err
	}
	if len(value) > MaxGeneratedValue {
		return nil, newInvalidInput("generated value exceeds limit")
	}
	return value, nil
}

func resolveValueFrom(src *ValueSource, state *evalState, policy Policy) ([]byte, error) {
	if src == nil {
		return nil, validationError("value_from is required")
	}
	switch src.Source {
	case ValueSourceBody:
		p, err := parseJSONPointer(src.Path)
		if err != nil {
			return nil, err
		}
		resolved, err := resolvePaths(state.body, p, false)
		if err != nil || len(resolved) == 0 {
			return missingValue(src, policy)
		}
		raw, exists, _, err := getRaw(state.body, resolved[0].gjson)
		if err != nil || !exists {
			return missingValue(src, policy)
		}
		return append([]byte(nil), raw...), nil
	case ValueSourceHeader:
		if !headerExists(state.headers, src.Path) {
			return missingValue(src, policy)
		}
		return encodeJSONString(state.headers.Get(src.Path)), nil
	case ValueSourceContext:
		v, ok, err := state.ctx.Lookup(src.Path)
		if err != nil {
			return nil, err
		}
		if !ok {
			return missingValue(src, policy)
		}
		return append([]byte(nil), v.Raw...), nil
	default:
		return nil, validationError("unsupported value_from source")
	}
}

func missingValue(src *ValueSource, policy Policy) ([]byte, error) {
	if src.Default.Present {
		return append([]byte(nil), src.Default.Raw...), nil
	}
	err := mapPolicyError(ErrorKindMissing, policy, "value_from path is missing")
	if err == nil {
		return nil, fmt.Errorf("missing")
	}
	return nil, err
}

func renderTemplate(tpl *compiledTemplate, state *evalState, policy Policy) (string, error) {
	if tpl == nil {
		return "", nil
	}
	var b strings.Builder
	for _, part := range tpl.parts {
		if part.literal {
			b.WriteString(part.text)
			continue
		}
		raw, err := resolveValueFrom(&ValueSource{Source: part.source, Path: part.path}, state, policy)
		if err != nil {
			return "", err
		}
		if kind, _ := detectJSONKind(raw); kind == kindString {
			s, err := decodeJSONString(raw)
			if err != nil {
				return "", err
			}
			b.WriteString(s)
			continue
		}
		b.Write(bytesTrim(raw))
	}
	out := b.String()
	if len(out) > MaxGeneratedValue {
		return "", newInvalidInput("generated value exceeds limit")
	}
	return out, nil
}

func headerText(raw []byte) (string, error) {
	kind, err := detectJSONKind(raw)
	if err != nil {
		return "", err
	}
	if kind == kindString {
		return decodeJSONString(raw)
	}
	return string(bytesTrim(raw)), nil
}

func handlePathErr(err error, policy Policy) (bool, []string, string, error) {
	if err == nil {
		return false, nil, "", nil
	}
	if _, ok := err.(*pathTypeError); ok {
		mapped := mapPolicyError(ErrorKindTypeMismatch, policy, err.Error())
		if mapped == nil {
			return false, nil, err.Error(), nil
		}
		return false, nil, "", mapped
	}
	return false, nil, "", mapRuntimeError(err, policy)
}

func mapRuntimeError(err error, policy Policy) *ApplyError {
	if err == nil {
		return nil
	}
	if ae, ok := err.(*ApplyError); ok {
		return ae
	}
	mapped := mapPolicyError(ErrorKindInvalidInput, policy, err.Error())
	if mapped == nil {
		return nil
	}
	return mapped
}

func modelWarning(op *compiledOp) string {
	if op.path != nil && op.path.raw == "/model" {
		return "this operation only changes the upstream model field and does not reroute or rebill"
	}
	if op.to != nil && op.to.raw == "/model" {
		return "this operation only changes the upstream model field and does not reroute or rebill"
	}
	return ""
}
