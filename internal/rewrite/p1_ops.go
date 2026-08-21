package rewrite

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/tidwall/gjson"
)

func applyStringMutate(op *compiledOp, state *evalState, transport Transport, mutate func(string) (string, bool, error)) (bool, []string, string, error) {
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
	for _, p := range paths {
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		raw, exists, _, err := getRaw(state.body, p.gjson)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !exists {
			if op.policy.OnMissing == OnMissingSkip {
				continue
			}
			return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "path is missing")
		}
		kind, err := detectJSONKind(raw)
		if err != nil || kind != kindString {
			mapped := mapPolicyError(ErrorKindTypeMismatch, op.policy, "path is not a string")
			if mapped == nil {
				continue
			}
			return false, nil, "", mapped
		}
		current, err := decodeJSONString(raw)
		if err != nil {
			return false, nil, "", err
		}
		next, ok, err := mutate(current)
		if err != nil {
			return false, nil, "", err
		}
		if !ok || next == current {
			continue
		}
		encoded := encodeJSONString(next)
		out, err := setRaw(state.body, p, encoded, false)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		state.body = out
		changed = true
		touched = append(touched, p.pointer)
	}
	return changed, touched, modelWarning(op), nil
}

func stringArg(op *compiledOp, state *evalState) (string, error) {
	if op.valueMode == valueNone {
		return "", nil
	}
	raw, err := resolveValue(op, state)
	if err != nil {
		return "", err
	}
	kind, err := detectJSONKind(raw)
	if err != nil {
		return "", err
	}
	if kind == kindString {
		return decodeJSONString(raw)
	}
	return string(bytes.TrimSpace(raw)), nil
}

func applyTrimPrefix(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	prefix, err := stringArg(op, state)
	if err != nil {
		return false, nil, "", err
	}
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		if prefix == "" || !strings.HasPrefix(current, prefix) {
			return current, false, nil
		}
		return strings.TrimPrefix(current, prefix), true, nil
	})
}

func applyTrimSuffix(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	suffix, err := stringArg(op, state)
	if err != nil {
		return false, nil, "", err
	}
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		if suffix == "" || !strings.HasSuffix(current, suffix) {
			return current, false, nil
		}
		return strings.TrimSuffix(current, suffix), true, nil
	})
}

func applyEnsurePrefix(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	prefix, err := stringArg(op, state)
	if err != nil {
		return false, nil, "", err
	}
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		if prefix == "" || strings.HasPrefix(current, prefix) {
			return current, false, nil
		}
		return prefix + current, true, nil
	})
}

func applyEnsureSuffix(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	suffix, err := stringArg(op, state)
	if err != nil {
		return false, nil, "", err
	}
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		if suffix == "" || strings.HasSuffix(current, suffix) {
			return current, false, nil
		}
		return current + suffix, true, nil
	})
}

func applyTrimSpace(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		next := strings.TrimSpace(current)
		return next, next != current, nil
	})
}

func applyToLower(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		next := strings.ToLower(current)
		return next, next != current, nil
	})
}

func applyToUpper(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		next := strings.ToUpper(current)
		return next, next != current, nil
	})
}

func applyReplace(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	search := op.raw.Search
	if search == "" {
		arg, err := stringArg(op, state)
		if err != nil {
			return false, nil, "", err
		}
		search = arg
	}
	repl := op.raw.Replacement
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		if search == "" || !strings.Contains(current, search) {
			return current, false, nil
		}
		return strings.ReplaceAll(current, search, repl), true, nil
	})
}

func applyRegexReplace(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	if op.regex == nil {
		return false, nil, "", validationError("regex_replace requires a compiled pattern")
	}
	repl := op.raw.Replacement
	return applyStringMutate(op, state, transport, func(current string) (string, bool, error) {
		next := op.regex.ReplaceAllString(current, repl)
		return next, next != current, nil
	})
}

func applyPruneObjects(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
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
	for _, p := range paths {
		if isProtectedBody(p.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + p.pointer)
		}
		raw, exists, _, err := getRaw(state.body, p.gjson)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !exists {
			continue
		}
		next, did, err := pruneValue(raw, op, state, boolDefault(op.raw.Recursive, true))
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		if !did {
			continue
		}
		out, err := setRaw(state.body, p, next, false)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		state.body = out
		changed = true
		touched = append(touched, p.pointer)
	}
	return changed, touched, "", nil
}

func pruneValue(raw []byte, op *compiledOp, state *evalState, recursive bool) ([]byte, bool, error) {
	parsed := gjson.ParseBytes(raw)
	switch {
	case parsed.IsArray():
		kept := make([]json.RawMessage, 0)
		changed := false
		for _, item := range parsed.Array() {
			itemRaw := []byte(item.Raw)
			if item.IsObject() && conditionMatchesItem(op.itemWhen, state, itemRaw) {
				changed = true
				continue
			}
			if recursive && (item.IsObject() || item.IsArray()) {
				next, did, err := pruneValue(itemRaw, op, state, true)
				if err != nil {
					return raw, false, err
				}
				if did {
					itemRaw = next
					changed = true
				}
			}
			kept = append(kept, itemRaw)
		}
		if !changed {
			return raw, false, nil
		}
		out, err := json.Marshal(kept)
		return out, true, err
	case parsed.IsObject():
		if !recursive {
			return raw, false, nil
		}
		result := []byte(parsed.Raw)
		changed := false
		parsed.ForEach(func(key, value gjson.Result) bool {
			child := []byte(value.Raw)
			keyName := key.String()
			keyPath := resolvedPath{
				sjson:   sjsonEscape(keyName),
				gjson:   pointerEscapeForGJSON(keyName),
				pointer: "/" + escapePointer(keyName),
			}
			if value.IsObject() && conditionMatchesItem(op.itemWhen, state, child) {
				var err error
				result, err = deletePath(result, keyPath)
				if err == nil {
					changed = true
				}
				return true
			}
			if value.IsObject() || value.IsArray() {
				next, did, err := pruneValue(child, op, state, true)
				if err == nil && did {
					result, err = setRaw(result, keyPath, next, false)
					if err == nil {
						changed = true
					}
				}
			}
			return true
		})
		return result, changed, nil
	default:
		return raw, false, &pathTypeError{path: op.path.raw, got: kindOfRaw(raw)}
	}
}

func conditionMatchesItem(cond *compiledCondition, state *evalState, item []byte) bool {
	if cond == nil {
		return false
	}
	itemState := *state
	itemState.item = item
	ok, err := cond.eval(itemState)
	return err == nil && ok
}

func applyHeaderPass(op *compiledOp, state *evalState) (bool, []string, string, error) {
	if state.inbound == nil {
		if op.policy.OnMissing == OnMissingSkip {
			return false, nil, "", nil
		}
		return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "inbound headers are missing")
	}
	names, err := headerPassNames(op, state)
	if err != nil {
		return false, nil, "", err
	}
	changed := false
	touched := make([]string, 0)
	for name := range state.inbound {
		if !headerPassAllowed(name, names, op.regex) {
			continue
		}
		if forbidProtectedHeader(name) != nil || isSensitiveHeader(name) {
			continue
		}
		values := append([]string(nil), state.inbound.Values(name)...)
		if len(values) == 0 {
			continue
		}
		state.headers.Del(name)
		for _, value := range values {
			state.headers.Add(name, value)
		}
		changed = true
		touched = append(touched, name)
	}
	return changed, touched, "", nil
}

func headerPassNames(op *compiledOp, state *evalState) ([]string, error) {
	if op.valueMode == valueNone {
		return nil, nil
	}
	raw, err := resolveValue(op, state)
	if err != nil {
		return nil, err
	}
	parsed := gjson.ParseBytes(raw)
	if parsed.Type == gjson.String {
		return []string{parsed.String()}, nil
	}
	if parsed.IsArray() {
		out := make([]string, 0, len(parsed.Array()))
		for _, item := range parsed.Array() {
			if item.Type == gjson.String {
				out = append(out, item.String())
			}
		}
		return out, nil
	}
	return nil, validationError("header_pass value must be a string or string array")
}

func headerPassAllowed(name string, allow []string, pattern *regexp.Regexp) bool {
	if isSensitiveHeader(name) {
		return false
	}
	star := false
	for _, item := range allow {
		if item == "*" {
			star = true
			continue
		}
		if strings.EqualFold(item, name) {
			return true
		}
	}
	if pattern != nil && pattern.MatchString(name) {
		return true
	}
	return star
}

func applySyncFields(op *compiledOp, state *evalState, transport Transport) (bool, []string, string, error) {
	if op.path == nil || strings.TrimSpace(op.raw.Header) == "" {
		return false, nil, "", validationError("sync_fields requires path and header")
	}
	if err := forbidProtectedHeader(op.raw.Header); err != nil {
		return false, nil, "", err
	}
	paths, err := resolvePaths(state.body, op.path, true)
	if err != nil {
		return handlePathErr(err, op.policy)
	}
	if len(paths) == 0 {
		paths = nil
	}
	headerPresent := headerExists(state.headers, op.raw.Header)
	bodyPresent := false
	var bodyRaw []byte
	var target resolvedPath
	if len(paths) > 0 {
		target = paths[0]
		raw, exists, _, err := getRaw(state.body, target.gjson)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		bodyPresent = exists
		bodyRaw = raw
	}
	if bodyPresent && !headerPresent {
		text, err := headerText(bodyRaw)
		if err != nil {
			return false, nil, "", err
		}
		headerSet(state.headers, op.raw.Header, text)
		return true, []string{op.raw.Header}, "", nil
	}
	if headerPresent && !bodyPresent {
		if len(paths) == 0 {
			if op.policy.OnMissing == OnMissingSkip {
				return false, nil, "", nil
			}
			return false, nil, "", mapPolicyError(ErrorKindMissing, op.policy, "path is missing")
		}
		if isProtectedBody(target.pointer, transport) {
			return false, nil, "", newInvalidInput("cannot rewrite protected field " + target.pointer)
		}
		value := encodeJSONString(state.headers.Get(op.raw.Header))
		out, err := setRaw(state.body, target, value, true)
		if err != nil {
			return handlePathErr(err, op.policy)
		}
		state.body = out
		return true, []string{target.pointer}, modelWarning(op), nil
	}
	return false, nil, "", nil
}
