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

func TestChatToolCallsConvertedToResponsesOmitItemIDs(t *testing.T) {
	messages := []model.Message{
		{
			Role: "assistant",
			ToolCalls: []model.ToolCall{
				{ID: "call_first", Type: "function", Function: model.FunctionCall{Name: "first", Arguments: "{}"}},
				{ID: "call_second", Type: "function", Function: model.FunctionCall{Name: "second", Arguments: "{}"}},
			},
		},
		{Role: "tool", ToolCallID: lo.ToPtr("call_first"), Content: model.MessageContent{Content: lo.ToPtr("first result")}},
		{Role: "tool", ToolCallID: lo.ToPtr("call_second"), Content: model.MessageContent{Content: lo.ToPtr("second result")}},
	}

	input := convertInputFromMessages(messages, model.TransformOptions{ArrayInputs: lo.ToPtr(true)})
	if len(input.Items) != 4 {
		t.Fatalf("expected 2 calls followed by 2 tool outputs, got %d items", len(input.Items))
	}
	for i, expectedCallID := range []string{"call_first", "call_second"} {
		call, result := input.Items[i], input.Items[i+2]
		if call.Type != "function_call" || result.Type != "function_call_output" {
			t.Fatalf("pair %d types: call=%q output=%q", i, call.Type, result.Type)
		}
		if call.ID != "" {
			t.Fatalf("synthetic function_call.id must be omitted, got %q", call.ID)
		}
		if call.CallID != expectedCallID || result.CallID != expectedCallID {
			t.Fatalf("pair %d lost call_id: call=%q output=%q want=%q", i, call.CallID, result.CallID, expectedCallID)
		}
	}

	raw, err := MarshalResponsesInputItems(messages)
	if err != nil {
		t.Fatal(err)
	}
	var wire []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, exists := wire[i]["id"]; exists {
			t.Fatalf("wire function_call[%d] includes an id: %s", i, wire[i]["id"])
		}
	}
}

func TestSanitizeResponsesItemsOnlyDropsInvalidFunctionCallIDs(t *testing.T) {
	original := []ResponsesItem{
		{Type: "function_call", ID: "item_legacy", CallID: "call_a"},
		{Type: "function_call", ID: "fc_valid", CallID: "call_b"},
		{Type: "message", ID: "msg_valid", Role: "assistant"},
	}
	got := sanitizeResponsesItems(original)
	if got[0].ID != "" || got[0].CallID != "call_a" {
		t.Fatalf("invalid function_call id not stripped without preserving call_id: %+v", got[0])
	}
	if got[1].ID != "fc_valid" || got[1].CallID != "call_b" {
		t.Fatalf("valid function_call id not preserved: %+v", got[1])
	}
	if got[2].ID != "msg_valid" {
		t.Fatalf("unrelated item id changed: %+v", got[2])
	}
	if original[0].ID != "item_legacy" {
		t.Fatal("sanitization mutated source items")
	}
}

func TestSanitizeResponsesRawItemsOnlyDropsInvalidFunctionCallIDs(t *testing.T) {
	raw := json.RawMessage(`[
		{"type":"function_call","id":"item_legacy","call_id":"call_a","name":"first","arguments":"{}"},
		{"type":"function_call","id":"fc_valid","call_id":"call_b","name":"second","arguments":"{}"},
		{"type":"function_call_output","call_id":"call_a","output":"ok"},
		{"type":"function_call_output","call_id":"call_b","output":"done"},
		{"type":"message","id":"msg_valid","role":"assistant","content":[{"type":"output_text","text":"hello"}]}
	]`)
	sanitized := sanitizeResponsesRawItems(raw)
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(sanitized, &items); err != nil {
		t.Fatal(err)
	}
	if _, exists := items[0]["id"]; exists {
		t.Fatalf("invalid function_call.id was forwarded: %s", items[0]["id"])
	}
	if got := decodeRawString(items[1]["id"]); got != "fc_valid" {
		t.Fatalf("valid function_call.id changed: %q", got)
	}
	if got := decodeRawString(items[4]["id"]); got != "msg_valid" {
		t.Fatalf("unrelated item id changed: %q", got)
	}
	for i, want := range []string{"call_a", "call_b", "call_a", "call_b"} {
		if got := decodeRawString(items[i]["call_id"]); got != want {
			t.Fatalf("item %d call_id changed: got %q, want %q", i, got, want)
		}
	}
}
