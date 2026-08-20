package rewrite

import (
	"net/http"
	"strings"
)

func headerExists(h http.Header, name string) bool {
	if h == nil {
		return false
	}
	return len(h.Values(name)) > 0
}

func cloneHeader(h http.Header) http.Header {
	if h == nil {
		return http.Header{}
	}
	return h.Clone()
}

func headerSet(h http.Header, name, value string) {
	h.Set(name, value)
}

func headerAdd(h http.Header, name, value string) {
	h.Add(name, value)
}

func headerDelete(h http.Header, name string) {
	h.Del(name)
}

func headerCopy(h http.Header, from, to string) bool {
	values := append([]string(nil), h.Values(from)...)
	if len(values) == 0 {
		return false
	}
	h.Del(to)
	for _, v := range values {
		h.Add(to, v)
	}
	return true
}

func headerMove(h http.Header, from, to string) bool {
	if !headerCopy(h, from, to) {
		return false
	}
	if !strings.EqualFold(from, to) {
		h.Del(from)
	}
	return true
}
