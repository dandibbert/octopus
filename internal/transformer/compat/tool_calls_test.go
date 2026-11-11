package compat

import (
	"testing"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

func TestFixOrphanedToolCallsInsertsMissingResults(t *testing.T) {
	followup := "next"
	messages := []model.Message{
		{
			Role: "assistant",
			ToolCalls: []model.ToolCall{
				{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}},
				{ID: "call_b", Function: model.FunctionCall{Name: "search"}},
			},
		},
		{
			Role:       "tool",
			ToolCallID: stringPtr("call_a"),
			Content:    model.MessageContent{Content: stringPtr("ok")},
		},
		{Role: "user", Content: model.MessageContent{Content: &followup}},
	}

	got := FixOrphanedToolCalls(messages)
	if len(got) != 4 {
		t.Fatalf("expected one synthetic tool result, got %d messages: %+v", len(got), got)
	}
	if got[1].Role != "tool" || got[1].ToolCallID == nil || *got[1].ToolCallID != "call_b" {
		t.Fatalf("unexpected synthetic tool result: %+v", got[1])
	}
	if got[1].Content.Content == nil || *got[1].Content.Content != "" {
		t.Fatalf("expected empty synthetic content, got %+v", got[1].Content)
	}
	if got[2].Role != "tool" || got[2].ToolCallID == nil || *got[2].ToolCallID != "call_a" {
		t.Fatalf("existing tool result was not preserved after synthetic result: %+v", got[2])
	}
}

func TestFixOrphanedToolCallsStopsAtNextAssistant(t *testing.T) {
	messages := []model.Message{
		{
			Role:      "assistant",
			ToolCalls: []model.ToolCall{{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}}},
		},
		{
			Role:      "assistant",
			ToolCalls: []model.ToolCall{{ID: "call_b", Function: model.FunctionCall{Name: "search"}}},
		},
		{
			Role:       "tool",
			ToolCallID: stringPtr("call_a"),
		},
	}

	got := FixOrphanedToolCalls(messages)
	if len(got) != 5 {
		t.Fatalf("expected both assistant turns to be patched independently, got %+v", got)
	}
	if got[1].ToolCallID == nil || *got[1].ToolCallID != "call_a" {
		t.Fatalf("first assistant was not patched before next assistant: %+v", got)
	}
	if got[3].ToolCallID == nil || *got[3].ToolCallID != "call_b" {
		t.Fatalf("second assistant was not patched: %+v", got)
	}
}

func TestRepairToolCallPairingInsertsMissingResultsInCallOrder(t *testing.T) {
	messages := []model.Message{
		{
			Role: "assistant",
			ToolCalls: []model.ToolCall{
				{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}},
				{ID: "call_b", Function: model.FunctionCall{Name: "search"}},
			},
		},
		{Role: "tool", ToolCallID: stringPtr("call_b"), Content: model.MessageContent{Content: stringPtr("b")}},
	}

	got := RepairToolCallPairing(messages)
	assertToolCallIDs(t, got, []string{"", "call_a", "call_b"})
	if got[1].Content.Content == nil || *got[1].Content.Content != "" {
		t.Fatalf("expected empty synthetic content, got %+v", got[1].Content)
	}
	if got[2].Content.Content == nil || *got[2].Content.Content != "b" {
		t.Fatalf("existing tool result content changed: %+v", got[2].Content)
	}
}

func TestRepairToolCallPairingDropsOrphanAndDuplicateResults(t *testing.T) {
	messages := []model.Message{
		{Role: "user", Content: model.MessageContent{Content: stringPtr("hi")}},
		{Role: "tool", ToolCallID: stringPtr("call_gone")},
		{
			Role:      "assistant",
			ToolCalls: []model.ToolCall{{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}}},
		},
		{Role: "tool", ToolCallID: stringPtr("call_a"), Content: model.MessageContent{Content: stringPtr("first")}},
		{Role: "tool", ToolCallID: stringPtr("call_a"), Content: model.MessageContent{Content: stringPtr("second")}},
		{Role: "tool", ToolCallID: stringPtr("call_other")},
		{Role: "tool"},
	}

	got := RepairToolCallPairing(messages)
	assertToolCallIDs(t, got, []string{"", "", "call_a"})
	if got[2].Content.Content == nil || *got[2].Content.Content != "first" {
		t.Fatalf("expected first result to be kept, got %+v", got[2].Content)
	}
}

func TestRepairToolCallPairingMovesInterleavedMessagesAfterResults(t *testing.T) {
	messages := []model.Message{
		{
			Role:      "assistant",
			ToolCalls: []model.ToolCall{{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}}},
		},
		{Role: "user", Content: model.MessageContent{Content: stringPtr("interrupt")}},
		{Role: "tool", ToolCallID: stringPtr("call_a")},
		{Role: "assistant", Content: model.MessageContent{Content: stringPtr("done")}},
	}

	got := RepairToolCallPairing(messages)
	if len(got) != 4 || got[1].Role != "tool" || got[2].Role != "user" || got[3].Role != "assistant" {
		t.Fatalf("unexpected order: %+v", got)
	}
}

func TestRepairToolCallPairingLeavesValidHistoryUnchanged(t *testing.T) {
	messages := []model.Message{
		{Role: "user", Content: model.MessageContent{Content: stringPtr("hi")}},
		{
			Role: "assistant",
			ToolCalls: []model.ToolCall{
				{ID: "call_a", Function: model.FunctionCall{Name: "lookup"}},
				{ID: "call_b", Function: model.FunctionCall{Name: "search"}},
			},
		},
		{Role: "tool", ToolCallID: stringPtr("call_a")},
		{Role: "tool", ToolCallID: stringPtr("call_b")},
		{Role: "assistant", Content: model.MessageContent{Content: stringPtr("done")}},
	}

	got := RepairToolCallPairing(messages)
	assertToolCallIDs(t, got, []string{"", "", "call_a", "call_b", ""})
}

func assertToolCallIDs(t *testing.T, got []model.Message, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("expected %d messages, got %d: %+v", len(want), len(got), got)
	}
	for i, id := range want {
		if id == "" {
			if got[i].Role == "tool" {
				t.Fatalf("message %d: expected non-tool message, got %+v", i, got[i])
			}
			continue
		}
		if got[i].Role != "tool" || got[i].ToolCallID == nil || *got[i].ToolCallID != id {
			t.Fatalf("message %d: expected tool result for %s, got %+v", i, id, got[i])
		}
	}
}

func stringPtr(v string) *string {
	return &v
}
