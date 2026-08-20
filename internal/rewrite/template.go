package rewrite

import (
	"fmt"
	"strings"
)

type compiledTemplate struct {
	parts []templatePart
}

type templatePart struct {
	literal bool
	text    string
	source  ValueSourceType
	path    string
}

func parseTemplate(raw string) (*compiledTemplate, error) {
	var parts []templatePart
	rest := raw
	for {
		start := strings.Index(rest, "${")
		if start < 0 {
			if rest != "" {
				parts = append(parts, templatePart{literal: true, text: rest})
			}
			break
		}
		if start > 0 {
			parts = append(parts, templatePart{literal: true, text: rest[:start]})
		}
		end := strings.Index(rest[start:], "}")
		if end < 0 {
			return nil, validationError("unterminated value_template interpolation")
		}
		end = start + end
		inner := rest[start+2 : end]
		source, path, err := parseTemplateVar(inner)
		if err != nil {
			return nil, err
		}
		parts = append(parts, templatePart{source: source, path: path})
		rest = rest[end+1:]
	}
	return &compiledTemplate{parts: parts}, nil
}

func parseTemplateVar(inner string) (ValueSourceType, string, error) {
	inner = strings.TrimSpace(inner)
	src, path, ok := strings.Cut(inner, ":")
	if !ok || path == "" {
		return "", "", validationError("value_template variables must be ${source:path}")
	}
	switch ValueSourceType(src) {
	case ValueSourceBody, ValueSourceHeader, ValueSourceContext:
		return ValueSourceType(src), path, nil
	default:
		return "", "", validationError(fmt.Sprintf("unsupported template source %q", src))
	}
}
