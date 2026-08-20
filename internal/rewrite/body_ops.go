package rewrite

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func setRaw(body []byte, path resolvedPath, value []byte, createParents bool) ([]byte, error) {
	_ = createParents
	if len(value) > MaxGeneratedValue {
		return body, fmt.Errorf("generated value exceeds limit")
	}
	out, err := sjson.SetRawBytes(body, path.sjson, value)
	if err != nil {
		return body, err
	}
	return out, nil
}

func deletePath(body []byte, path resolvedPath) ([]byte, error) {
	out, err := sjson.DeleteBytes(body, path.sjson)
	if err != nil {
		return body, err
	}
	return out, nil
}

func copyPath(body []byte, from, to resolvedPath) ([]byte, bool, error) {
	raw, exists, _, err := getRaw(body, from.gjson)
	if err != nil || !exists {
		return body, false, err
	}
	out, err := setRaw(body, to, append([]byte(nil), raw...), true)
	return out, true, err
}

func movePath(body []byte, from, to resolvedPath) ([]byte, bool, error) {
	out, ok, err := copyPath(body, from, to)
	if err != nil || !ok {
		return body, ok, err
	}
	if from.sjson == to.sjson {
		return out, true, nil
	}
	out, err = deletePath(out, from)
	return out, true, err
}

func ensureArray(body []byte, path resolvedPath) ([]byte, error) {
	raw, exists, _, err := getRaw(body, path.gjson)
	if err != nil {
		return body, err
	}
	if !exists {
		return setRaw(body, path, []byte("[]"), true)
	}
	if !gjson.ParseBytes(raw).IsArray() {
		return body, &pathTypeError{path: path.pointer, got: kindOfRaw(raw)}
	}
	return body, nil
}

func arrayInsertValues(body []byte, path resolvedPath, values [][]byte, index *int, prepend bool) ([]byte, error) {
	var err error
	body, err = ensureArray(body, path)
	if err != nil {
		return body, err
	}
	raw, exists, _, err := getRaw(body, path.gjson)
	if err != nil || !exists {
		return body, err
	}
	arr := gjson.ParseBytes(raw).Array()
	insertAt := len(arr)
	if prepend {
		insertAt = 0
	}
	if index != nil {
		insertAt = *index
		if insertAt < 0 {
			insertAt = len(arr) + insertAt
		}
		if insertAt < 0 {
			insertAt = 0
		}
		if insertAt > len(arr) {
			insertAt = len(arr)
		}
	}
	items := make([]json.RawMessage, 0, len(arr)+len(values))
	for i, item := range arr {
		if i == insertAt {
			for _, v := range values {
				items = append(items, json.RawMessage(v))
			}
		}
		items = append(items, json.RawMessage(item.Raw))
	}
	if insertAt >= len(arr) {
		for _, v := range values {
			items = append(items, json.RawMessage(v))
		}
	}
	encoded, err := json.Marshal(items)
	if err != nil {
		return body, err
	}
	return setRaw(body, path, encoded, false)
}

func arrayRemoveMatching(body []byte, path resolvedPath, itemWhen *compiledCondition, state evalState) ([]byte, []string, error) {
	raw, exists, _, err := getRaw(body, path.gjson)
	if err != nil {
		return body, nil, err
	}
	if !exists {
		return body, nil, nil
	}
	node := gjson.ParseBytes(raw)
	if !node.IsArray() {
		return body, nil, &pathTypeError{path: path.pointer, got: kindOfRaw(raw)}
	}
	kept := make([]json.RawMessage, 0)
	removed := make([]string, 0)
	for i, item := range node.Array() {
		itemState := state
		itemState.item = []byte(item.Raw)
		ok, err := itemWhen.eval(itemState)
		if err != nil {
			return body, nil, err
		}
		if ok {
			removed = append(removed, path.pointer+"/"+strconv.Itoa(i))
			continue
		}
		kept = append(kept, json.RawMessage(item.Raw))
	}
	if len(removed) == 0 {
		return body, nil, nil
	}
	encoded, err := json.Marshal(kept)
	if err != nil {
		return body, nil, err
	}
	out, err := setRaw(body, path, encoded, false)
	return out, removed, err
}

func splatValues(value []byte, splat bool) [][]byte {
	if splat && len(bytesTrim(value)) > 0 && bytesTrim(value)[0] == '[' {
		arr := gjson.ParseBytes(value).Array()
		out := make([][]byte, 0, len(arr))
		for _, item := range arr {
			out = append(out, []byte(item.Raw))
		}
		return out
	}
	return [][]byte{append([]byte(nil), value...)}
}

func pathExists(body []byte, path resolvedPath) bool {
	_, exists, _, _ := getRaw(body, path.gjson)
	return exists
}

func compactEqual(a, b []byte) bool {
	return bytes.Equal(bytes.TrimSpace(a), bytes.TrimSpace(b))
}
