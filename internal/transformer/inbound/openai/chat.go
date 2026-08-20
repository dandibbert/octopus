package openai

import (
	"context"
	"encoding/json"

	"github.com/bestruirui/octopus/internal/transformer/model"
)

type ChatInbound struct {
	streamAggregator model.StreamAggregator
	// storedResponse stores the non-stream response
	storedResponse *model.InternalLLMResponse
}

func (i *ChatInbound) TransformRequest(ctx context.Context, body []byte) (*model.InternalLLMRequest, error) {
	var request model.InternalLLMRequest
	if err := json.Unmarshal(body, &request); err != nil {
		return nil, err
	}
	// O-H2: tag the origin so outbound transformers (raw passthrough,
	// alternation enforcement, schema conversion) can tell a Chat request
	// apart from a Responses request.
	request.RawAPIFormat = model.APIFormatOpenAIChatCompletion
	return &request, nil
}

func (i *ChatInbound) TransformResponse(ctx context.Context, response *model.InternalLLMResponse) ([]byte, error) {
	// Store the response for later retrieval
	i.storedResponse = response

	body, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	return body, nil
}

func (i *ChatInbound) TransformStream(ctx context.Context, stream *model.InternalLLMResponse) ([]byte, error) {
	if stream.Object == "[DONE]" {
		return []byte("data: [DONE]\n\n"), nil
	}

	// Store the chunk for aggregation
	i.streamAggregator.Add(stream)

	var body []byte
	var err error

	// Handle the case where choices are empty but we need them to be present as an empty array
	// This is to satisfy some clients (like Cherry Studio) that require choices field to be present
	if len(stream.Choices) == 0 && stream.Object == "chat.completion.chunk" {
		type Alias model.InternalLLMResponse
		aux := &struct {
			*Alias
			Choices []model.Choice `json:"choices"`
		}{
			Alias:   (*Alias)(stream),
			Choices: []model.Choice{},
		}
		body, err = json.Marshal(aux)
	} else {
		body, err = json.Marshal(stream)
	}

	if err != nil {
		return nil, err
	}
	return []byte("data: " + string(body) + "\n\n"), nil
}

func (i *ChatInbound) TransformStreamEvents(ctx context.Context, events []model.StreamEvent) ([]byte, error) {
	stream := model.InternalResponseFromStreamEvents(events)
	if stream == nil {
		return nil, nil
	}
	return i.TransformStream(ctx, stream)
}

// GetInternalResponse returns the complete internal response for logging, statistics, etc.
// For streaming: aggregates all stored stream chunks into a complete response
// For non-streaming: returns the stored response
func (i *ChatInbound) GetInternalResponse(ctx context.Context) (*model.InternalLLMResponse, error) {
	if i.storedResponse != nil {
		return i.storedResponse, nil
	}
	return i.streamAggregator.BuildAndReset(), nil
}

func (i *ChatInbound) TransformError(ctx context.Context, statusCode int, message string, mode model.ErrorOutputMode) ([]byte, error) {
	return formatOpenAIChatError(statusCode, message, mode)
}

func formatOpenAIChatError(statusCode int, message string, mode model.ErrorOutputMode) ([]byte, error) {
	if message == "" {
		message = "channel failed"
	}
	payload := map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    openAIErrorType(statusCode),
			"code":    openAIErrorCode(statusCode),
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if mode == model.ErrorOutputCommittedStream {
		return []byte("data: " + string(body) + "\n\n"), nil
	}
	return body, nil
}

func openAIErrorType(statusCode int) string {
	switch statusCode {
	case 400, 422:
		return "invalid_request_error"
	case 401:
		return "authentication_error"
	case 403:
		return "permission_error"
	case 404:
		return "not_found_error"
	case 429:
		return "rate_limit_error"
	default:
		return "api_error"
	}
}

func openAIErrorCode(statusCode int) string {
	switch statusCode {
	case 400, 422:
		return "invalid_request"
	case 401:
		return "invalid_api_key"
	case 403:
		return "permission_denied"
	case 404:
		return "not_found"
	case 429:
		return "rate_limit_exceeded"
	default:
		return "server_error"
	}
}
