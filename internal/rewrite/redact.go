package rewrite

import "strings"

func RedactHeaderValue(name, value string) string {
	if isSensitiveHeader(name) {
		return "***"
	}
	lower := strings.ToLower(name)
	if strings.Contains(lower, "authorization") || strings.Contains(lower, "api-key") || strings.Contains(lower, "cookie") {
		return "***"
	}
	return value
}

func RedactHeadersMap(headers map[string][]string) map[string][]string {
	out := make(map[string][]string, len(headers))
	for k, values := range headers {
		cloned := make([]string, len(values))
		for i, v := range values {
			cloned[i] = RedactHeaderValue(k, v)
		}
		out[k] = cloned
	}
	return out
}
