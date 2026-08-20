package rewrite

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type decodedConfig struct {
	Config  *Config
	Legacy  bool
	RawHash string
}

func decodeRaw(raw *string) (*decodedConfig, error) {
	if raw == nil {
		return &decodedConfig{}, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return &decodedConfig{}, nil
	}
	if len(trimmed) > MaxConfigBytes {
		return nil, validationError(fmt.Sprintf("config exceeds %d bytes", MaxConfigBytes))
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, validationError("config is not valid JSON")
	}
	hash := sha256Hex([]byte(trimmed))
	var probe map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return nil, validationError("config must be a JSON object")
	}
	schemaRaw, hasSchema := probe["$schema"]
	if hasSchema {
		var schema string
		if err := json.Unmarshal(schemaRaw, &schema); err != nil {
			return nil, validationError("$schema must be a string")
		}
		if schema != SchemaV2 {
			return nil, validationError(fmt.Sprintf("unknown request rewrite schema %q", schema))
		}
		var cfg Config
		dec := json.NewDecoder(bytes.NewReader([]byte(trimmed)))
		dec.DisallowUnknownFields()
		if err := json.Unmarshal([]byte(trimmed), &cfg); err != nil {
			return nil, validationError(fmt.Sprintf("invalid v2 config: %v", err))
		}
		return &decodedConfig{Config: &cfg, RawHash: hash}, nil
	}
	if looksLikeV2(probe) {
		return nil, validationError("missing V2 schema: add \"$schema\": \"octopus.request-rewrite/v2\"")
	}
	legacy, err := decodeLegacyObject([]byte(trimmed))
	if err != nil {
		return nil, err
	}
	return &decodedConfig{Config: legacy, Legacy: true, RawHash: hash}, nil
}

func looksLikeV2(probe map[string]json.RawMessage) bool {
	_, hasOps := probe["operations"]
	_, hasStage := probe["stage"]
	_, hasPolicy := probe["policy"]
	return hasOps || (hasStage && hasPolicy)
}

func decodeLegacyObject(raw []byte) (*Config, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, validationError("legacy param_override must be a JSON object")
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	ops := make([]Operation, 0, len(keys))
	for _, key := range keys {
		path := "/" + escapePointer(key)
		val := bytes.TrimSpace(obj[key])
		id := "legacy-" + sanitizeID(key)
		if string(val) == "null" {
			ops = append(ops, Operation{
				ID:   id,
				Op:   OpDelete,
				Path: path,
			})
			continue
		}
		var ov OptionalRawValue
		if err := ov.UnmarshalJSON(val); err != nil {
			return nil, validationError(fmt.Sprintf("legacy value for %q is invalid", key))
		}
		ops = append(ops, Operation{
			ID:    id,
			Op:    OpSet,
			Path:  path,
			Value: ov,
		})
	}
	enabled := true
	stage := StageOutboundProvider
	return &Config{
		Schema:     SchemaV2,
		Stage:      stage,
		Enabled:    &enabled,
		Policy:     DefaultPolicy(),
		Operations: ops,
	}, nil
}

func sanitizeID(key string) string {
	var b strings.Builder
	for _, r := range key {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('-')
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "field"
	}
	return out
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
