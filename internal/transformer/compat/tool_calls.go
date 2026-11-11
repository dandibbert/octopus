package compat

import (
	"strings"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

// PatchAnthropicRequest applies small protocol repairs before Anthropic wire
// conversion. It is intentionally narrow: only fixes cases known to trigger
// strict Anthropic schema errors.
func PatchAnthropicRequest(req *model.InternalLLMRequest) {
	if req == nil || len(req.Messages) == 0 {
		return
	}
	req.Messages = FixOrphanedToolCalls(req.Messages)
}

// PatchOpenAIChatRequest repairs tool call / tool result pairing before Chat
// Completions wire conversion. Strict OpenAI-compatible upstreams reject the
// whole request when an assistant tool_call has no matching tool message, when
// a tool message answers no preceding tool_call, or when another message sits
// between a tool_call and its result.
func PatchOpenAIChatRequest(req *model.InternalLLMRequest) {
	if req == nil || len(req.Messages) == 0 {
		return
	}
	req.Messages = RepairToolCallPairing(req.Messages)
}

// RepairToolCallPairing places each assistant turn's tool results directly
// after it in tool_call order, synthesizes empty results for unanswered calls,
// and drops tool messages that answer no tool_call of the preceding assistant
// turn (orphans and duplicates). Non-tool messages found between an assistant
// turn and its results are moved after the results.
func RepairToolCallPairing(messages []model.Message) []model.Message {
	if len(messages) == 0 {
		return messages
	}

	out := make([]model.Message, 0, len(messages))
	for i := 0; i < len(messages); {
		msg := messages[i]
		if msg.Role == "tool" {
			i++
			continue
		}
		out = append(out, msg)
		i++
		if msg.Role != "assistant" || len(msg.ToolCalls) == 0 {
			continue
		}

		pending := make(map[string]struct{}, len(msg.ToolCalls))
		for _, toolCall := range msg.ToolCalls {
			if id := strings.TrimSpace(toolCall.ID); id != "" {
				pending[id] = struct{}{}
			}
		}

		results := make(map[string]model.Message, len(pending))
		var others []model.Message
		for ; i < len(messages) && messages[i].Role != "assistant"; i++ {
			next := messages[i]
			if next.Role != "tool" {
				others = append(others, next)
				continue
			}
			if next.ToolCallID == nil {
				continue
			}
			id := strings.TrimSpace(*next.ToolCallID)
			if _, ok := pending[id]; !ok {
				continue
			}
			if _, seen := results[id]; seen {
				continue
			}
			results[id] = next
		}

		for _, toolCall := range msg.ToolCalls {
			id := strings.TrimSpace(toolCall.ID)
			if _, ok := pending[id]; !ok {
				continue
			}
			delete(pending, id)
			if result, ok := results[id]; ok {
				out = append(out, result)
			} else {
				out = append(out, emptyToolResult(toolCall))
			}
		}
		out = append(out, others...)
	}
	return out
}

// FixOrphanedToolCalls inserts empty tool_result messages for assistant
// tool_use blocks that are not answered before the next assistant turn.
func FixOrphanedToolCalls(messages []model.Message) []model.Message {
	if len(messages) == 0 {
		return messages
	}

	out := make([]model.Message, 0, len(messages))
	for i := 0; i < len(messages); i++ {
		msg := messages[i]
		out = append(out, msg)
		if msg.Role != "assistant" || len(msg.ToolCalls) == 0 {
			continue
		}

		answered := answeredToolCallIDsBeforeNextAssistant(messages, i+1)
		for _, toolCall := range msg.ToolCalls {
			id := strings.TrimSpace(toolCall.ID)
			if id == "" {
				continue
			}
			if _, ok := answered[id]; ok {
				continue
			}
			out = append(out, emptyToolResult(toolCall))
		}
	}
	return out
}

func answeredToolCallIDsBeforeNextAssistant(messages []model.Message, start int) map[string]struct{} {
	answered := make(map[string]struct{})
	for i := start; i < len(messages); i++ {
		msg := messages[i]
		if msg.Role == "assistant" {
			break
		}
		if msg.Role != "tool" || msg.ToolCallID == nil {
			continue
		}
		id := strings.TrimSpace(*msg.ToolCallID)
		if id != "" {
			answered[id] = struct{}{}
		}
	}
	return answered
}

func emptyToolResult(toolCall model.ToolCall) model.Message {
	id := toolCall.ID
	name := toolCall.Function.Name
	content := ""
	return model.Message{
		Role:         "tool",
		Content:      model.MessageContent{Content: &content},
		ToolCallID:   &id,
		ToolCallName: &name,
	}
}
