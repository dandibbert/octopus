package openai

import (
	"encoding/json"
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/samber/lo"
)

func toolCallConversation() []model.Message {
	return []model.Message{
		{
			Role: "assistant",
			ToolCalls: []model.ToolCall{{
				ID:   "call_abc123",
				Type: "function",
				Function: model.FunctionCall{
					Name:      "get_weather",
					Arguments: `{"location":"Beijing"}`,
				},
			}},
		},
		{
			Role:       "tool",
			ToolCallID: lo.ToPtr("call_abc123"),
			Content: model.MessageContent{
				Content: lo.ToPtr("Sunny, 25°C"),
			},
		},
	}
}

func TestConvertInputFromMessagesDoesNotAddItemReference(t *testing.T) {
	input := convertInputFromMessages(toolCallConversation(), model.TransformOptions{ArrayInputs: lo.ToPtr(true)})
	if len(input.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(input.Items))
	}
	if input.Items[0].Type != "function_call" {
		t.Fatalf("expected first item to be function_call, got %s", input.Items[0].Type)
	}
	if input.Items[1].Type != "function_call_output" {
		t.Fatalf("expected second item to be function_call_output, got %s", input.Items[1].Type)
	}

	raw, err := json.Marshal(input.Items[1])
	if err != nil {
		t.Fatalf("marshal function_call_output: %v", err)
	}
	var output map[string]json.RawMessage
	if err := json.Unmarshal(raw, &output); err != nil {
		t.Fatalf("unmarshal function_call_output: %v", err)
	}
	if _, exists := output["item_reference"]; exists {
		t.Fatalf("function_call_output must not contain item_reference: %s", raw)
	}
	if got := decodeRawString(output["call_id"]); got != "call_abc123" {
		t.Fatalf("expected call_id=call_abc123, got %q", got)
	}
}

func TestSanitizeResponsesRawItemsStripsFunctionCallOutputItemReference(t *testing.T) {
	rawItems := json.RawMessage(`[
		{"id":"item_xyz","type":"function_call","call_id":"call_1","name":"f","arguments":"{}"},
		{"type":"function_call_output","call_id":"call_1","item_reference":"item_xyz","output":"ok"}
	]`)
	sanitized := sanitizeResponsesRawItems(rawItems)

	var items []map[string]json.RawMessage
	if err := json.Unmarshal(sanitized, &items); err != nil {
		t.Fatalf("unmarshal sanitized items: %v", err)
	}
	if _, exists := items[1]["item_reference"]; exists {
		t.Fatalf("function_call_output item_reference was not stripped: %s", sanitized)
	}
	if got := decodeRawString(items[1]["call_id"]); got != "call_1" {
		t.Fatalf("expected call_id=call_1, got %q", got)
	}
}

func TestSanitizeResponsesRawItemsPreservesStandaloneItemReference(t *testing.T) {
	rawItems := json.RawMessage(`[
		{"type":"item_reference","id":"rs_123"}
	]`)
	sanitized := sanitizeResponsesRawItems(rawItems)

	var items []map[string]json.RawMessage
	if err := json.Unmarshal(sanitized, &items); err != nil {
		t.Fatalf("unmarshal sanitized items: %v", err)
	}
	if got := decodeRawString(items[0]["type"]); got != "item_reference" {
		t.Fatalf("expected standalone item_reference to survive, got %q", got)
	}
	if got := decodeRawString(items[0]["id"]); got != "rs_123" {
		t.Fatalf("expected standalone item_reference id=rs_123, got %q", got)
	}
}

func TestMarshalResponsesInputItemsOmitsFunctionCallOutputItemReference(t *testing.T) {
	rawItems, err := MarshalResponsesInputItems(toolCallConversation())
	if err != nil {
		t.Fatalf("MarshalResponsesInputItems failed: %v", err)
	}

	var items []map[string]json.RawMessage
	if err := json.Unmarshal(rawItems, &items); err != nil {
		t.Fatalf("unmarshal marshaled items: %v", err)
	}
	for _, item := range items {
		if decodeRawString(item["type"]) != "function_call_output" {
			continue
		}
		if _, exists := item["item_reference"]; exists {
			t.Fatalf("marshaled function_call_output must not contain item_reference: %s", rawItems)
		}
		return
	}
	t.Fatal("function_call_output item not found")
}
