package openai

import (
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestResponseOutboundAllowPassthrough(t *testing.T) {
	o := &ResponseOutbound{}
	fresh := &model.InternalLLMRequest{RawAPIFormat: model.APIFormatOpenAIResponse}
	if !o.AllowPassthrough(fresh, true) {
		t.Fatal("fresh HTTP request should allow passthrough")
	}
	if o.AllowPassthrough(fresh, false) {
		t.Fatal("missing client context should veto passthrough")
	}

	replay := &model.InternalLLMRequest{RawAPIFormat: model.APIFormatOpenAIResponse}
	replay.MarkOpenAIExactReplayRequest()
	if o.AllowPassthrough(replay, true) {
		t.Fatal("exact replay should veto passthrough")
	}

	prev := "resp_123"
	continuation := &model.InternalLLMRequest{
		RawAPIFormat:       model.APIFormatOpenAIResponse,
		PreviousResponseID: &prev,
	}
	if o.AllowPassthrough(continuation, true) {
		t.Fatal("continuation should veto passthrough")
	}
}
