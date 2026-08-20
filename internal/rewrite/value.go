package rewrite

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type OptionalRawValue struct {
	Present bool
	Raw     json.RawMessage
	Kind    jsonKind
}

func (v OptionalRawValue) IsNull() bool {
	return v.Present && v.Kind == kindNull
}

func (v *OptionalRawValue) UnmarshalJSON(data []byte) error {
	if v == nil {
		return fmt.Errorf("OptionalRawValue is nil")
	}
	if len(data) == 0 || string(data) == "null" && !json.Valid(data) {
		v.Present = false
		v.Raw = nil
		v.Kind = ""
		return nil
	}
	if !json.Valid(data) {
		return fmt.Errorf("invalid JSON value")
	}
	kind, err := detectJSONKind(data)
	if err != nil {
		return err
	}
	v.Present = true
	v.Raw = append(json.RawMessage(nil), data...)
	v.Kind = kind
	return nil
}

func (v OptionalRawValue) MarshalJSON() ([]byte, error) {
	if !v.Present {
		return []byte("null"), nil
	}
	if len(v.Raw) == 0 {
		return []byte("null"), nil
	}
	return append([]byte(nil), v.Raw...), nil
}

func detectJSONKind(data []byte) (jsonKind, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return "", fmt.Errorf("empty JSON value")
	}
	switch data[0] {
	case 'n':
		if string(data) == "null" {
			return kindNull, nil
		}
	case 't', 'f':
		if string(data) == "true" || string(data) == "false" {
			return kindBool, nil
		}
	case '"':
		return kindString, nil
	case '{':
		return kindObject, nil
	case '[':
		return kindArray, nil
	case '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		return kindNumber, nil
	}
	return "", fmt.Errorf("unsupported JSON value")
}

func rawFromLiteral(v any) (OptionalRawValue, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return OptionalRawValue{}, err
	}
	var out OptionalRawValue
	if err := out.UnmarshalJSON(b); err != nil {
		return OptionalRawValue{}, err
	}
	return out, nil
}

func encodeJSONString(s string) json.RawMessage {
	b, err := json.Marshal(s)
	if err != nil {
		return json.RawMessage(`""`)
	}
	return b
}
