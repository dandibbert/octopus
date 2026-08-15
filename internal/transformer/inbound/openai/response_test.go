package openai

import (
	"encoding/json"
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestConvertToInternalRequestPreservesRawInputItems(t *testing.T) {
	req := &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Items: []ResponsesItem{
			{Type: "input_text", Text: stringPtr("hello")},
		}},
	}

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.RawInputItems) == 0 {
		t.Fatalf("expected raw input items to be preserved")
	}

	var items []map[string]any
	if err := json.Unmarshal(internalReq.RawInputItems, &items); err != nil {
		t.Fatalf("unmarshal raw input items failed: %v", err)
	}
	if len(items) != 1 || items[0]["type"] != "input_text" {
		t.Fatalf("expected original raw input items to be kept, got %#v", items)
	}
	if internalReq.TransformOptions.ArrayInputs == nil || !*internalReq.TransformOptions.ArrayInputs {
		t.Fatalf("expected array input flag to stay true")
	}
}

func TestConvertToInternalRequestMarksPassthroughForUnsupportedToolType(t *testing.T) {
	req := &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Text: stringPtr("hello")},
		Tools: []ResponsesTool{{
			Type: "apply_patch",
		}},
	}

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if !internalReq.HasOpenAIResponsesPassthrough() {
		t.Fatalf("expected unsupported responses tool to require passthrough")
	}
	if ext := internalReq.GetOpenAIExtensions(); !ext.ResponsesPassthroughRequired || ext.ResponsesPassthroughReason != "tool:apply_patch" {
		t.Fatalf("expected OpenAI extension passthrough view, got %#v", ext)
	}
}

func TestConvertToInternalRequestMarksPassthroughForUnsupportedInputItem(t *testing.T) {
	req := &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Items: []ResponsesItem{{
			Type:   "apply_patch_call_output",
			CallID: "apc_123",
		}}},
	}

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if !internalReq.HasOpenAIResponsesPassthrough() {
		t.Fatalf("expected unsupported responses input item to require passthrough")
	}
	if ext := internalReq.GetOpenAIExtensions(); !ext.ResponsesPassthroughRequired || ext.ResponsesPassthroughReason != "input:apply_patch_call_output" {
		t.Fatalf("expected OpenAI extension passthrough view, got %#v", ext)
	}
}

func TestConvertToInternalRequestDoesNotMarkPassthroughForSupportedFileAndAudioInputs(t *testing.T) {
	req := &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Items: []ResponsesItem{
			{
				Type: "message",
				Role: "user",
				Content: &ResponsesInput{Items: []ResponsesItem{
					{Type: "input_file", FileID: stringPtr("file_123")},
					{Type: "input_audio", InputAudio: &ResponsesInputAudio{Format: "wav", Data: "AAA="}},
				}},
			},
		}},
	}

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if internalReq.HasOpenAIResponsesPassthrough() {
		t.Fatalf("expected supported file/audio inputs to stay normalized without passthrough")
	}
	if len(internalReq.Messages) != 1 || len(internalReq.Messages[0].Content.MultipleContent) != 2 {
		t.Fatalf("expected supported file/audio inputs to normalize into message content, got %#v", internalReq.Messages)
	}
	if internalReq.Messages[0].Content.MultipleContent[0].Type != "file" {
		t.Fatalf("expected file content part, got %#v", internalReq.Messages[0].Content.MultipleContent[0])
	}
	if internalReq.Messages[0].Content.MultipleContent[1].Type != "input_audio" {
		t.Fatalf("expected input_audio content part, got %#v", internalReq.Messages[0].Content.MultipleContent[1])
	}
}

func TestConvertToInternalRequestNormalizesTopLevelInputFile(t *testing.T) {
	req := &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Items: []ResponsesItem{{
			Type:     "input_file",
			FileID:   stringPtr("file_456"),
			Filename: stringPtr("notes.txt"),
		}}},
	}

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if internalReq.HasOpenAIResponsesPassthrough() {
		t.Fatalf("expected top-level input_file to stay normalized without passthrough")
	}
	if len(internalReq.Messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", internalReq.Messages)
	}
	if internalReq.Messages[0].Role != "user" {
		t.Fatalf("expected top-level input_file to default to user role, got %#v", internalReq.Messages[0].Role)
	}
	if len(internalReq.Messages[0].Content.MultipleContent) != 1 || internalReq.Messages[0].Content.MultipleContent[0].Type != "file" {
		t.Fatalf("expected top-level input_file to become file content, got %#v", internalReq.Messages[0].Content)
	}
	if internalReq.Messages[0].Content.MultipleContent[0].File == nil || internalReq.Messages[0].Content.MultipleContent[0].File.FileID != "file_456" {
		t.Fatalf("expected normalized file reference to preserve file_id, got %#v", internalReq.Messages[0].Content.MultipleContent[0].File)
	}
}

func TestConvertToInternalRequestGroupsSameNameParallelFunctionCalls(t *testing.T) {
	req := responsesRequestWithItems(
		functionCallItem("run_code_1", "run_code", `{"code":"first"}`),
		functionCallItem("run_code_2", "run_code", `{"code":"second"}`),
		functionCallOutputItem("run_code_1", "first result"),
		functionCallOutputItem("run_code_2", "second result"),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 3 {
		t.Fatalf("expected one assistant turn followed by two tool results, got %#v", internalReq.Messages)
	}

	assertToolCallMessage(t, internalReq.Messages[0], []expectedToolCall{
		{id: "run_code_1", name: "run_code", arguments: `{"code":"first"}`, index: 0},
		{id: "run_code_2", name: "run_code", arguments: `{"code":"second"}`, index: 1},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "run_code_1", "first result")
	assertToolOutputMessage(t, internalReq.Messages[2], "run_code_2", "second result")
}

func TestConvertToInternalRequestPreservesSingleFunctionCall(t *testing.T) {
	req := responsesRequestWithItems(
		functionCallItem("call_lookup", "lookup", `{"query":"octopus"}`),
		functionCallOutputItem("call_lookup", "found"),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 2 {
		t.Fatalf("expected assistant and tool messages, got %#v", internalReq.Messages)
	}

	assertToolCallMessage(t, internalReq.Messages[0], []expectedToolCall{
		{id: "call_lookup", name: "lookup", arguments: `{"query":"octopus"}`, index: 0},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "call_lookup", "found")
}

func TestConvertToInternalRequestGroupsDifferentParallelFunctionCalls(t *testing.T) {
	req := responsesRequestWithItems(
		functionCallItem("call_search", "search", `{"query":"octopus"}`),
		functionCallItem("call_weather", "weather", `{"city":"Tokyo"}`),
		functionCallOutputItem("call_search", "search result"),
		functionCallOutputItem("call_weather", "sunny"),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 3 {
		t.Fatalf("expected one assistant turn followed by two tool results, got %#v", internalReq.Messages)
	}

	assertToolCallMessage(t, internalReq.Messages[0], []expectedToolCall{
		{id: "call_search", name: "search", arguments: `{"query":"octopus"}`, index: 0},
		{id: "call_weather", name: "weather", arguments: `{"city":"Tokyo"}`, index: 1},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "call_search", "search result")
	assertToolOutputMessage(t, internalReq.Messages[2], "call_weather", "sunny")
}

func TestConvertToInternalRequestCarriesReasoningIntoParallelFunctionCallTurn(t *testing.T) {
	signature := "encrypted-reasoning"
	req := responsesRequestWithItems(
		ResponsesItem{
			Type: "reasoning",
			Summary: []ResponsesReasoningSummary{
				{Type: "summary_text", Text: "inspect both inputs"},
			},
			EncryptedContent: &signature,
		},
		functionCallItem("call_first", "run_code", `{"code":"first"}`),
		functionCallItem("call_second", "run_code", `{"code":"second"}`),
		functionCallOutputItem("call_first", "first result"),
		functionCallOutputItem("call_second", "second result"),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 3 {
		t.Fatalf("expected reasoning and calls in one assistant turn, got %#v", internalReq.Messages)
	}

	assistant := internalReq.Messages[0]
	if assistant.ReasoningContent == nil || *assistant.ReasoningContent != "inspect both inputs" {
		t.Fatalf("reasoning content was not preserved: %#v", assistant.ReasoningContent)
	}
	if assistant.ReasoningSignature == nil || *assistant.ReasoningSignature != signature {
		t.Fatalf("reasoning signature was not preserved: %#v", assistant.ReasoningSignature)
	}
	assertToolCallMessage(t, assistant, []expectedToolCall{
		{id: "call_first", name: "run_code", arguments: `{"code":"first"}`, index: 0},
		{id: "call_second", name: "run_code", arguments: `{"code":"second"}`, index: 1},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "call_first", "first result")
	assertToolOutputMessage(t, internalReq.Messages[2], "call_second", "second result")
}

func TestConvertToInternalRequestDoesNotGroupFunctionCallsAcrossBoundaries(t *testing.T) {
	req := responsesRequestWithItems(
		functionCallItem("call_before_output", "first", `{}`),
		functionCallOutputItem("call_before_output", "first result"),
		functionCallItem("call_before_user", "second", `{}`),
		ResponsesItem{
			Type: "message",
			Role: "user",
			Content: &ResponsesInput{Items: []ResponsesItem{
				{Type: "input_text", Text: stringPtr("continue")},
			}},
		},
		functionCallItem("call_after_user", "third", `{}`),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 5 {
		t.Fatalf("expected tool output and user message to preserve turn boundaries, got %#v", internalReq.Messages)
	}

	assertToolCallMessage(t, internalReq.Messages[0], []expectedToolCall{
		{id: "call_before_output", name: "first", arguments: `{}`, index: 0},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "call_before_output", "first result")
	assertToolCallMessage(t, internalReq.Messages[2], []expectedToolCall{
		{id: "call_before_user", name: "second", arguments: `{}`, index: 0},
	})
	assertTextMessage(t, internalReq.Messages[3], "user", "continue")
	assertToolCallMessage(t, internalReq.Messages[4], []expectedToolCall{
		{id: "call_after_user", name: "third", arguments: `{}`, index: 0},
	})
}

func TestConvertToInternalRequestGroupsEachFunctionCallTurnIndependently(t *testing.T) {
	req := responsesRequestWithItems(
		functionCallItem("turn_1_call_1", "lookup", `{"part":1}`),
		functionCallItem("turn_1_call_2", "lookup", `{"part":2}`),
		functionCallOutputItem("turn_1_call_1", "one"),
		functionCallOutputItem("turn_1_call_2", "two"),
		ResponsesItem{
			Type: "message",
			Role: "user",
			Content: &ResponsesInput{Items: []ResponsesItem{
				{Type: "input_text", Text: stringPtr("next turn")},
			}},
		},
		functionCallItem("turn_2_call_1", "search", `{"part":3}`),
		functionCallItem("turn_2_call_2", "weather", `{"part":4}`),
		functionCallOutputItem("turn_2_call_1", "three"),
		functionCallOutputItem("turn_2_call_2", "four"),
	)

	internalReq, err := convertToInternalRequest(req)
	if err != nil {
		t.Fatalf("convertToInternalRequest failed: %v", err)
	}
	if len(internalReq.Messages) != 7 {
		t.Fatalf("expected two independently grouped assistant turns, got %#v", internalReq.Messages)
	}

	assertToolCallMessage(t, internalReq.Messages[0], []expectedToolCall{
		{id: "turn_1_call_1", name: "lookup", arguments: `{"part":1}`, index: 0},
		{id: "turn_1_call_2", name: "lookup", arguments: `{"part":2}`, index: 1},
	})
	assertToolOutputMessage(t, internalReq.Messages[1], "turn_1_call_1", "one")
	assertToolOutputMessage(t, internalReq.Messages[2], "turn_1_call_2", "two")
	assertTextMessage(t, internalReq.Messages[3], "user", "next turn")
	assertToolCallMessage(t, internalReq.Messages[4], []expectedToolCall{
		{id: "turn_2_call_1", name: "search", arguments: `{"part":3}`, index: 0},
		{id: "turn_2_call_2", name: "weather", arguments: `{"part":4}`, index: 1},
	})
	assertToolOutputMessage(t, internalReq.Messages[5], "turn_2_call_1", "three")
	assertToolOutputMessage(t, internalReq.Messages[6], "turn_2_call_2", "four")
}

type expectedToolCall struct {
	id        string
	name      string
	arguments string
	index     int
}

func responsesRequestWithItems(items ...ResponsesItem) *ResponsesRequest {
	return &ResponsesRequest{
		Model: "gpt-4o",
		Input: ResponsesInput{Items: items},
	}
}

func functionCallItem(callID, name, arguments string) ResponsesItem {
	return ResponsesItem{
		Type:      "function_call",
		CallID:    callID,
		Name:      name,
		Arguments: arguments,
	}
}

func functionCallOutputItem(callID, output string) ResponsesItem {
	return ResponsesItem{
		Type:   "function_call_output",
		CallID: callID,
		Output: &ResponsesInput{Text: stringPtr(output)},
	}
}

func assertToolCallMessage(t *testing.T, message model.Message, expected []expectedToolCall) {
	t.Helper()

	if message.Role != "assistant" {
		t.Fatalf("expected assistant role, got %q", message.Role)
	}
	if len(message.ToolCalls) != len(expected) {
		t.Fatalf("expected %d tool calls, got %#v", len(expected), message.ToolCalls)
	}
	for i, want := range expected {
		got := message.ToolCalls[i]
		if got.ID != want.id || got.Function.Name != want.name || got.Function.Arguments != want.arguments || got.Index != want.index {
			t.Fatalf("tool call %d mismatch: got %#v, want id=%q name=%q arguments=%q index=%d", i, got, want.id, want.name, want.arguments, want.index)
		}
	}
}

func assertToolOutputMessage(t *testing.T, message model.Message, callID, output string) {
	t.Helper()

	if message.Role != "tool" {
		t.Fatalf("expected tool role, got %q", message.Role)
	}
	if message.ToolCallID == nil || *message.ToolCallID != callID {
		t.Fatalf("expected tool_call_id %q, got %#v", callID, message.ToolCallID)
	}
	if message.Content.Content == nil || *message.Content.Content != output {
		t.Fatalf("expected tool output %q, got %#v", output, message.Content)
	}
}

func assertTextMessage(t *testing.T, message model.Message, role, content string) {
	t.Helper()

	if message.Role != role {
		t.Fatalf("expected role %q, got %q", role, message.Role)
	}
	if message.Content.Content == nil || *message.Content.Content != content {
		t.Fatalf("expected message content %q, got %#v", content, message.Content)
	}
}

func stringPtr(value string) *string {
	return &value
}
