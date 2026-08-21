package rewrite

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

type tokenKind int

const (
	tokenName tokenKind = iota
	tokenIndex
	tokenLast
	tokenNthLast
	tokenWildcard
	tokenAppend
)

type pathToken struct {
	kind  tokenKind
	name  string
	index int
}

type parsedPath struct {
	raw    string
	tokens []pathToken
}

func parseJSONPointer(raw string) (*parsedPath, error) {
	if raw == "" {
		return nil, fmt.Errorf("root path is not allowed")
	}
	if len(raw) > MaxPathBytes {
		return nil, fmt.Errorf("path exceeds %d bytes", MaxPathBytes)
	}
	if !strings.HasPrefix(raw, "/") {
		return nil, fmt.Errorf("path must start with /")
	}
	if !utf8.ValidString(raw) {
		return nil, fmt.Errorf("path is not valid utf-8")
	}
	parts := strings.Split(raw, "/")[1:]
	tokens := make([]pathToken, 0, len(parts))
	for _, part := range parts {
		switch part {
		case "*":
			tokens = append(tokens, pathToken{kind: tokenWildcard})
		case "-":
			tokens = append(tokens, pathToken{kind: tokenAppend})
		default:
			decoded, err := unescapePointer(part)
			if err != nil {
				return nil, err
			}
			if decoded == "-1" || (strings.HasPrefix(decoded, "-") && isAllDigits(decoded[1:])) {
				n, err := strconv.Atoi(decoded)
				if err != nil {
					return nil, fmt.Errorf("invalid negative index %q", decoded)
				}
				if n == -1 {
					tokens = append(tokens, pathToken{kind: tokenLast})
				} else {
					tokens = append(tokens, pathToken{kind: tokenNthLast, index: -n})
				}
				continue
			}
			if isAllDigits(decoded) {
				n, err := strconv.Atoi(decoded)
				if err != nil {
					return nil, fmt.Errorf("invalid array index %q", decoded)
				}
				tokens = append(tokens, pathToken{kind: tokenIndex, index: n})
				continue
			}
			tokens = append(tokens, pathToken{kind: tokenName, name: decoded})
		}
	}
	return &parsedPath{raw: raw, tokens: tokens}, nil
}

func unescapePointer(s string) (string, error) {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '~' {
			b.WriteByte(s[i])
			continue
		}
		if i+1 >= len(s) {
			return "", fmt.Errorf("invalid JSON Pointer escape in %q", s)
		}
		switch s[i+1] {
		case '0':
			b.WriteByte('~')
		case '1':
			b.WriteByte('/')
		default:
			return "", fmt.Errorf("invalid JSON Pointer escape ~%c in %q", s[i+1], s)
		}
		i++
	}
	return b.String(), nil
}

func escapePointer(s string) string {
	s = strings.ReplaceAll(s, "~", "~0")
	s = strings.ReplaceAll(s, "/", "~1")
	return s
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func pointerEscapeForGJSON(key string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`.`, `\.`,
		`*`, `\*`,
		`?`, `\?`,
		`|`, `\|`,
		`#`, `\#`,
		`@`, `\@`,
	)
	return replacer.Replace(key)
}

func (p *parsedPath) gjsonPath() string {
	if p == nil {
		return ""
	}
	parts := make([]string, 0, len(p.tokens))
	for _, tok := range p.tokens {
		switch tok.kind {
		case tokenName:
			parts = append(parts, pointerEscapeForGJSON(tok.name))
		case tokenIndex:
			parts = append(parts, strconv.Itoa(tok.index))
		case tokenLast:
			parts = append(parts, "-1")
		case tokenNthLast:
			parts = append(parts, strconv.Itoa(-tok.index))
		case tokenWildcard:
			parts = append(parts, "#")
		case tokenAppend:
			parts = append(parts, "-1")
		}
	}
	return strings.Join(parts, ".")
}

func (p *parsedPath) hasWildcard() bool {
	for _, tok := range p.tokens {
		if tok.kind == tokenWildcard {
			return true
		}
	}
	return false
}

func (p *parsedPath) hasAppend() bool {
	for _, tok := range p.tokens {
		if tok.kind == tokenAppend {
			return true
		}
	}
	return false
}

type resolvedPath struct {
	pointer string
	gjson   string
	sjson   string
}

func resolvePaths(body []byte, p *parsedPath, createParents bool) ([]resolvedPath, error) {
	if p == nil {
		return nil, fmt.Errorf("empty path")
	}
	type frame struct {
		pointer string
		gjson   string
		sjson   string
	}
	frames := []frame{{pointer: "", gjson: "", sjson: ""}}
	for i, tok := range p.tokens {
		next := make([]frame, 0, len(frames))
		last := i == len(p.tokens)-1
		for _, fr := range frames {
			current := body
			if fr.gjson != "" {
				currentRaw := gjson.GetBytes(body, fr.gjson)
				if !currentRaw.Exists() {
					if !createParents {
						continue
					}
					current = nil
				} else {
					current = []byte(currentRaw.Raw)
				}
			}
			switch tok.kind {
			case tokenName:
				child := frame{
					pointer: fr.pointer + "/" + escapePointer(tok.name),
					gjson:   joinGJSON(fr.gjson, pointerEscapeForGJSON(tok.name)),
					sjson:   joinSJSON(fr.sjson, tok.name),
				}
				if !last && createParents {
					node := gjson.GetBytes(body, child.gjson)
					if !node.Exists() {
						container := intermediateContainerFor(p.tokens[i+1])
						var err error
						body, err = sjson.SetRawBytes(body, child.sjson, container)
						if err != nil {
							return nil, err
						}
					} else if !intermediateContainerMatches(node, p.tokens[i+1]) {
						return nil, &pathTypeError{path: child.pointer, got: node.Type.String()}
					}
				}
				next = append(next, child)
			case tokenIndex, tokenLast, tokenNthLast:
				node := gjson.ParseBytes(current)
				// RFC 6901 pointer tokens are strings. A decimal token is an array
				// index only when its parent is actually an array; on an object,
				// `/0` addresses the literal key "0".
				if tok.kind == tokenIndex && node.IsObject() {
					seg := strconv.Itoa(tok.index)
					child := frame{
						pointer: fr.pointer + "/" + seg,
						gjson:   joinGJSON(fr.gjson, pointerEscapeForGJSON(seg)),
						sjson:   joinSJSON(fr.sjson, seg),
					}
					if !last && createParents {
						childNode := gjson.GetBytes(body, child.gjson)
						if !childNode.Exists() {
							container := intermediateContainerFor(p.tokens[i+1])
							var err error
							body, err = sjson.SetRawBytes(body, child.sjson, container)
							if err != nil {
								return nil, err
							}
						} else if !intermediateContainerMatches(childNode, p.tokens[i+1]) {
							return nil, &pathTypeError{path: child.pointer, got: kindOfRaw([]byte(childNode.Raw))}
						}
					}
					next = append(next, child)
					continue
				}
				if current != nil && !node.IsArray() && gjson.ValidBytes(current) && len(bytesTrim(current)) > 0 && current[0] != '[' {
					if createParents && last {
						return nil, &pathTypeError{path: fr.pointer, got: "object"}
					}
					if !createParents {
						continue
					}
					return nil, &pathTypeError{path: fr.pointer, got: kindOfRaw(current)}
				}
				idx, ok := resolveIndex(current, tok)
				if !ok {
					continue
				}
				seg := strconv.Itoa(idx)
				child := frame{
					pointer: fr.pointer + "/" + seg,
					gjson:   joinGJSON(fr.gjson, seg),
					sjson:   joinSJSON(fr.sjson, seg),
				}
				next = append(next, child)
			case tokenWildcard:
				node := gjson.ParseBytes(current)
				if node.IsArray() {
					arr := node.Array()
					for i := range arr {
						seg := strconv.Itoa(i)
						next = append(next, frame{
							pointer: fr.pointer + "/" + seg,
							gjson:   joinGJSON(fr.gjson, seg),
							sjson:   joinSJSON(fr.sjson, seg),
						})
					}
				} else if node.IsObject() {
					keys := make([]string, 0)
					node.ForEach(func(key, value gjson.Result) bool {
						keys = append(keys, key.String())
						return true
					})
					sort.Strings(keys)
					for _, key := range keys {
						next = append(next, frame{
							pointer: fr.pointer + "/" + escapePointer(key),
							gjson:   joinGJSON(fr.gjson, pointerEscapeForGJSON(key)),
							sjson:   joinSJSON(fr.sjson, key),
						})
					}
				}
			case tokenAppend:
				if !last {
					return nil, fmt.Errorf("/- is only valid as a terminal append token")
				}
				// `/-` is an append selector for array operations, not a request to
				// rewrite the current last element. Resolve it to the parent array;
				// the array operation chooses the insertion index.
				next = append(next, fr)
			}
		}
		frames = next
		if len(frames) == 0 {
			break
		}
	}
	out := make([]resolvedPath, 0, len(frames))
	for _, fr := range frames {
		out = append(out, resolvedPath{pointer: fr.pointer, gjson: fr.gjson, sjson: fr.sjson})
	}
	return out, nil
}

func tokenRequiresArrayParent(tok pathToken) bool {
	switch tok.kind {
	case tokenLast, tokenNthLast, tokenAppend:
		return true
	default:
		return false
	}
}

func intermediateContainerFor(next pathToken) []byte {
	if next.kind == tokenIndex || tokenRequiresArrayParent(next) {
		return []byte("[]")
	}
	return []byte("{}")
}

func intermediateContainerMatches(node gjson.Result, next pathToken) bool {
	if next.kind == tokenIndex {
		return node.IsArray() || node.IsObject()
	}
	if tokenRequiresArrayParent(next) {
		return node.IsArray()
	}
	if next.kind == tokenWildcard {
		return node.IsArray() || node.IsObject()
	}
	return node.IsObject()
}

type pathTypeError struct {
	path string
	got  string
}

func (e *pathTypeError) Error() string {
	return fmt.Sprintf("type mismatch at %s: %s", e.path, e.got)
}

func resolveIndex(current []byte, tok pathToken) (int, bool) {
	n := 0
	if len(current) > 0 {
		node := gjson.ParseBytes(current)
		if node.IsArray() {
			n = len(node.Array())
		}
	}
	switch tok.kind {
	case tokenIndex:
		if tok.index < 0 || tok.index >= n {
			return 0, false
		}
		return tok.index, true
	case tokenLast:
		if n == 0 {
			return 0, false
		}
		return n - 1, true
	case tokenNthLast:
		idx := n - tok.index
		if idx < 0 || idx >= n {
			return 0, false
		}
		return idx, true
	}
	return 0, false
}

func joinGJSON(base, seg string) string {
	if base == "" {
		return seg
	}
	return base + "." + seg
}

func joinSJSON(base, seg string) string {
	if base == "" {
		return sjsonEscape(seg)
	}
	return base + "." + sjsonEscape(seg)
}

func sjsonEscape(key string) string {
	if key == "" {
		return key
	}
	need := strings.ContainsAny(key, ".|*?#@") || strings.Contains(key, `\`)
	if !need {
		return key
	}
	return pointerEscapeForGJSON(key)
}

func bytesTrim(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\t' || b[i] == '\r') {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\t' || b[j-1] == '\r') {
		j--
	}
	return b[i:j]
}

func kindOfRaw(b []byte) string {
	b = bytesTrim(b)
	if len(b) == 0 {
		return "empty"
	}
	switch b[0] {
	case '{':
		return "object"
	case '[':
		return "array"
	case '"':
		return "string"
	case 't', 'f':
		return "boolean"
	case 'n':
		return "null"
	default:
		return "number"
	}
}

func getRaw(body []byte, gjsonPath string) (raw []byte, exists bool, isNull bool, err error) {
	res := gjson.GetBytes(body, gjsonPath)
	if !res.Exists() {
		return nil, false, false, nil
	}
	return []byte(res.Raw), true, res.Type == gjson.Null, nil
}
