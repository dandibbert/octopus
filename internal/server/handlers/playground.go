package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/relay"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/bestruirui/octopus/internal/transformer/inbound"
	"github.com/gin-gonic/gin"
)

const (
	maxPlaygroundBodyBytes   = 1 << 20
	maxPlaygroundMessages    = 100
	maxPlaygroundTextBytes   = 64 << 10
	maxPlaygroundOutputToken = 131072
	healthProbeTimeout       = 30 * time.Second
	playgroundMaxRPM         = 60
	healthProbeMaxRPM        = 60
	playgroundRateLimitKey   = -10001
	healthProbeRateLimitKey  = -10002

	codePlaygroundConcurrentLimit        = "playground.concurrent_limit"
	codePlaygroundRateLimited            = "playground.rate_limited"
	codePlaygroundMessagesRequired       = "playground.messages_required"
	codePlaygroundMessagesLimit          = "playground.messages_limit"
	codePlaygroundTextTooLong            = "playground.text_too_long"
	codePlaygroundUnsupportedRole        = "playground.unsupported_role"
	codePlaygroundTemperatureRange       = "playground.temperature_range"
	codePlaygroundMaxOutputTokensRange   = "playground.max_output_tokens_range"
	codePlaygroundInvalidReasoningEffort = "playground.invalid_reasoning_effort"
	codePlaygroundTargetRequired         = "playground.target_required"
	codePlaygroundTargetUnavailable      = "playground.target_unavailable"
	codePlaygroundModelNotConfigured     = "playground.model_not_configured"
	codePlaygroundUnsupportedTargetType  = "playground.unsupported_target_type"
	codePlaygroundExecutionFailed        = "playground.execution_failed"
)

var (
	playgroundSlots  = make(chan struct{}, 8)
	healthProbeSlots = make(chan struct{}, 8)
)

type playgroundTarget struct {
	Type      string `json:"type" binding:"required"`
	Group     string `json:"group,omitempty"`
	GroupID   int    `json:"group_id,omitempty"`
	ChannelID int    `json:"channel_id,omitempty"`
	Model     string `json:"model,omitempty"`
}

type playgroundMessage struct {
	Role    string `json:"role" binding:"required"`
	Content string `json:"content" binding:"required"`
}

type playgroundParameters struct {
	ReasoningEffort string   `json:"reasoning_effort,omitempty"`
	Temperature     *float64 `json:"temperature,omitempty"`
	MaxOutputTokens *int     `json:"max_output_tokens,omitempty"`
	Stream          bool     `json:"stream"`
}

type playgroundChatRequest struct {
	Target       playgroundTarget     `json:"target" binding:"required"`
	Messages     []playgroundMessage  `json:"messages" binding:"required"`
	SystemPrompt string               `json:"system_prompt,omitempty"`
	Parameters   playgroundParameters `json:"parameters"`
}

type modelHealthRequest struct {
	Model     string `json:"model" binding:"required"`
	KeyID     int    `json:"key_id,omitempty"`
	TimeoutMS int    `json:"timeout_ms,omitempty"`
}

type executionHealthResult struct {
	Success         bool                   `json:"success"`
	LatencyMS       int64                  `json:"latency_ms"`
	ChannelID       int                    `json:"channel_id,omitempty"`
	ChannelName     string                 `json:"channel_name,omitempty"`
	RequestedModel  string                 `json:"requested_model,omitempty"`
	ActualModel     string                 `json:"actual_model,omitempty"`
	Group           string                 `json:"group,omitempty"`
	SelectedChannel string                 `json:"selected_channel,omitempty"`
	RemoteModel     string                 `json:"remote_model,omitempty"`
	RequestID       string                 `json:"request_id"`
	StatusCode      int                    `json:"status_code"`
	Error           string                 `json:"error,omitempty"`
	Attempts        []model.ChannelAttempt `json:"attempts,omitempty"`
}

type healthCompletionPayload struct {
	Model   string                   `json:"model"`
	Choices []healthCompletionChoice `json:"choices"`
	Error   json.RawMessage          `json:"error"`
}

type healthCompletionChoice struct {
	Message json.RawMessage `json:"message"`
	Text    *string         `json:"text"`
}

type playgroundAPIError struct {
	status  int
	code    string
	message string
	params  map[string]any
}

func (e *playgroundAPIError) Error() string {
	return e.message
}

func newPlaygroundAPIError(status int, code, message string, params map[string]any) error {
	return &playgroundAPIError{status: status, code: code, message: message, params: params}
}

func respondPlaygroundError(c *gin.Context, status int, code, message string, params map[string]any) {
	resp.ErrorWithCodeAndParams(c, status, code, message, params)
}

func respondPlaygroundBuildError(c *gin.Context, err error) {
	var apiErr *playgroundAPIError
	if errors.As(err, &apiErr) {
		respondPlaygroundError(c, apiErr.status, apiErr.code, apiErr.message, apiErr.params)
		return
	}
	respondPlaygroundError(c, http.StatusInternalServerError, codePlaygroundExecutionFailed, "failed to prepare playground request", nil)
}

var secretPattern = regexp.MustCompile(`(?i)\b(authorization|x[-_]api[-_]key|api[-_]key|access[-_]token|token)\b(["'\s]*[:=]["'\s]*)(bearer\s+)?[^,\s"'}&]+|bearer\s+[^,\s"'}]+|sk-[a-z0-9_-]{8,}`)

func init() {
	router.NewGroupRouter("/api/v1/playground").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(router.NewRoute("/chat", http.MethodPost).Handle(playgroundChat))

	router.NewGroupRouter("/api/v1/channel").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(router.NewRoute("/:id/models/health", http.MethodPost).Handle(channelModelHealth))

	router.NewGroupRouter("/api/v1/group").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(router.NewRoute("/:id/health", http.MethodPost).Handle(groupRouteHealth))
}

func playgroundChat(c *gin.Context) {
	if !enforceAdminRateLimit(c, playgroundRateLimitKey, playgroundMaxRPM) {
		return
	}
	if !tryAcquire(playgroundSlots) {
		respondPlaygroundError(c, http.StatusTooManyRequests, codePlaygroundConcurrentLimit, "too many concurrent playground requests", map[string]any{"limit": cap(playgroundSlots)})
		return
	}
	defer release(playgroundSlots)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPlaygroundBodyBytes)
	var req playgroundChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if len(req.Messages) == 0 {
		respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundMessagesRequired, "at least one message is required", nil)
		return
	}
	if len(req.Messages) > maxPlaygroundMessages {
		respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundMessagesLimit, "too many messages", map[string]any{"max": maxPlaygroundMessages})
		return
	}
	if len(req.SystemPrompt) > maxPlaygroundTextBytes {
		respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundTextTooLong, "system_prompt is too long", map[string]any{"maxBytes": maxPlaygroundTextBytes})
		return
	}
	for index, message := range req.Messages {
		if len(message.Content) > maxPlaygroundTextBytes {
			respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundTextTooLong, "message content is too long", map[string]any{"maxBytes": maxPlaygroundTextBytes, "index": index + 1})
			return
		}
	}

	body, groupOverride, err := buildPlaygroundRelayRequest(c, req)
	if err != nil {
		respondPlaygroundBuildError(c, err)
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Request.ContentLength = int64(len(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("api_key_id", 0)
	c.Set("billing_require_known", false)
	c.Set("request_source", model.RelayLogRequestSourcePlayground)
	c.Header("X-Octopus-Request-Source", model.RelayLogRequestSourcePlayground)
	c.Header("X-Octopus-Request-ID", fmt.Sprintf("playground-%d", time.Now().UnixNano()))

	if groupOverride != nil {
		relay.ExecuteDirectWithGroup(inbound.InboundTypeOpenAIChat, c, *groupOverride)
		return
	}
	relay.Handler(inbound.InboundTypeOpenAIChat, c)
}

func buildPlaygroundRelayRequest(c *gin.Context, req playgroundChatRequest) ([]byte, *model.Group, error) {
	messages := make([]map[string]string, 0, len(req.Messages)+1)
	if prompt := strings.TrimSpace(req.SystemPrompt); prompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": prompt})
	}
	for index, message := range req.Messages {
		role := strings.TrimSpace(message.Role)
		if role != "user" && role != "assistant" && role != "system" {
			return nil, nil, newPlaygroundAPIError(
				http.StatusBadRequest,
				codePlaygroundUnsupportedRole,
				fmt.Sprintf("unsupported message role %q", role),
				map[string]any{"role": role, "index": index + 1},
			)
		}
		messages = append(messages, map[string]string{"role": role, "content": message.Content})
	}

	payload := map[string]any{"messages": messages, "stream": req.Parameters.Stream}
	if req.Parameters.Temperature != nil {
		if *req.Parameters.Temperature < 0 || *req.Parameters.Temperature > 2 {
			return nil, nil, newPlaygroundAPIError(
				http.StatusBadRequest,
				codePlaygroundTemperatureRange,
				"temperature must be between 0 and 2",
				map[string]any{"min": 0, "max": 2},
			)
		}
		payload["temperature"] = *req.Parameters.Temperature
	}
	if req.Parameters.MaxOutputTokens != nil {
		if *req.Parameters.MaxOutputTokens <= 0 || *req.Parameters.MaxOutputTokens > maxPlaygroundOutputToken {
			return nil, nil, newPlaygroundAPIError(
				http.StatusBadRequest,
				codePlaygroundMaxOutputTokensRange,
				fmt.Sprintf("max_output_tokens must be between 1 and %d", maxPlaygroundOutputToken),
				map[string]any{"min": 1, "max": maxPlaygroundOutputToken},
			)
		}
		payload["max_tokens"] = *req.Parameters.MaxOutputTokens
	}
	effort := strings.ToLower(strings.TrimSpace(req.Parameters.ReasoningEffort))
	switch effort {
	case "", "auto":
	case "off":
		payload["reasoning_effort"] = "none"
	case "low", "medium", "high", "xhigh":
		payload["reasoning_effort"] = effort
	default:
		return nil, nil, newPlaygroundAPIError(
			http.StatusBadRequest,
			codePlaygroundInvalidReasoningEffort,
			"invalid reasoning_effort",
			map[string]any{"effort": effort},
		)
	}

	switch req.Target.Type {
	case "group":
		groupName := strings.TrimSpace(req.Target.Group)
		if req.Target.GroupID > 0 {
			group, err := op.GroupGet(req.Target.GroupID, c.Request.Context())
			if err != nil {
				return nil, nil, newPlaygroundAPIError(
					http.StatusNotFound,
					codePlaygroundTargetUnavailable,
					"playground group target is unavailable",
					map[string]any{"targetType": "group", "targetId": req.Target.GroupID},
				)
			}
			groupName = group.Name
		}
		if groupName == "" {
			return nil, nil, newPlaygroundAPIError(http.StatusBadRequest, codePlaygroundTargetRequired, "group target is required", nil)
		}
		payload["model"] = groupName
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, nil, newPlaygroundAPIError(http.StatusInternalServerError, codePlaygroundExecutionFailed, "failed to encode playground request", nil)
		}
		return body, nil, nil
	case "channel_model":
		modelName := strings.TrimSpace(req.Target.Model)
		if req.Target.ChannelID <= 0 || modelName == "" {
			return nil, nil, newPlaygroundAPIError(http.StatusBadRequest, codePlaygroundTargetRequired, "channel_id and model are required", nil)
		}
		channel, err := op.ChannelGet(req.Target.ChannelID, c.Request.Context())
		if err != nil {
			return nil, nil, newPlaygroundAPIError(
				http.StatusNotFound,
				codePlaygroundTargetUnavailable,
				"playground channel target is unavailable",
				map[string]any{"targetType": "channel", "targetId": req.Target.ChannelID},
			)
		}
		if !channelHasModel(channel, modelName) {
			return nil, nil, newPlaygroundAPIError(
				http.StatusBadRequest,
				codePlaygroundModelNotConfigured,
				fmt.Sprintf("model %q is not configured on channel", modelName),
				map[string]any{"model": modelName, "channelId": req.Target.ChannelID},
			)
		}
		payload["model"] = modelName
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, nil, newPlaygroundAPIError(http.StatusInternalServerError, codePlaygroundExecutionFailed, "failed to encode playground request", nil)
		}
		group := directExecutionGroup(channel.ID, modelName)
		return body, &group, nil
	default:
		return nil, nil, newPlaygroundAPIError(
			http.StatusBadRequest,
			codePlaygroundUnsupportedTargetType,
			"unsupported target type",
			map[string]any{"type": req.Target.Type},
		)
	}
}

func channelModelHealth(c *gin.Context) {
	if !enforceAdminRateLimit(c, healthProbeRateLimitKey, healthProbeMaxRPM) {
		return
	}
	if !tryAcquire(healthProbeSlots) {
		respondPlaygroundError(c, http.StatusTooManyRequests, codePlaygroundConcurrentLimit, "too many concurrent health checks", map[string]any{"limit": cap(healthProbeSlots)})
		return
	}
	defer release(healthProbeSlots)
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPlaygroundBodyBytes)
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		resp.InvalidParam(c)
		return
	}
	var req modelHealthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	channel, err := op.ChannelGet(channelID, c.Request.Context())
	if err != nil {
		respondPlaygroundError(c, http.StatusNotFound, codePlaygroundTargetUnavailable, "playground channel target is unavailable", map[string]any{"targetType": "channel", "targetId": channelID})
		return
	}
	modelName := strings.TrimSpace(req.Model)
	if !channelHasModel(channel, modelName) {
		respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundModelNotConfigured, fmt.Sprintf("model %q is not configured on channel", modelName), map[string]any{"model": modelName, "channelId": channelID})
		return
	}
	if req.KeyID > 0 {
		found := false
		for _, key := range channel.Keys {
			if key.ID == req.KeyID && key.Enabled && strings.TrimSpace(key.ChannelKey) != "" {
				found = true
				break
			}
		}
		if !found {
			respondPlaygroundError(c, http.StatusBadRequest, codePlaygroundTargetUnavailable, "selected channel key is unavailable", map[string]any{"keyId": req.KeyID})
			return
		}
	}
	group := directExecutionGroup(channelID, modelName)
	timeout := healthProbeTimeout
	if req.TimeoutMS > 0 {
		if req.TimeoutMS > 300000 {
			req.TimeoutMS = 300000
		}
		timeout = time.Duration(req.TimeoutMS) * time.Millisecond
	}
	result := runHealthProbe(c, modelName, &group, req.KeyID, timeout)
	result.ChannelID = channelID
	result.ChannelName = channel.Name
	result.RequestedModel = modelName
	resp.Success(c, result)
}

func groupRouteHealth(c *gin.Context) {
	if !enforceAdminRateLimit(c, healthProbeRateLimitKey, healthProbeMaxRPM) {
		return
	}
	if !tryAcquire(healthProbeSlots) {
		respondPlaygroundError(c, http.StatusTooManyRequests, codePlaygroundConcurrentLimit, "too many concurrent health checks", map[string]any{"limit": cap(healthProbeSlots)})
		return
	}
	defer release(healthProbeSlots)
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil || groupID <= 0 {
		resp.InvalidParam(c)
		return
	}
	group, err := op.GroupGet(groupID, c.Request.Context())
	if err != nil {
		respondPlaygroundError(c, http.StatusNotFound, codePlaygroundTargetUnavailable, "playground group target is unavailable", map[string]any{"targetType": "group", "targetId": groupID})
		return
	}
	result := runHealthProbe(c, group.Name, nil, 0, healthProbeTimeout)
	result.Group = group.Name
	result.SelectedChannel = result.ChannelName
	resp.Success(c, result)
}

func runHealthProbe(parent *gin.Context, requestModel string, groupOverride *model.Group, preferredKeyID int, timeout time.Duration) executionHealthResult {
	started := time.Now()
	requestID := fmt.Sprintf("health-%d", started.UnixNano())
	body, _ := json.Marshal(map[string]any{
		"model":       requestModel,
		"messages":    []map[string]string{{"role": "user", "content": "Reply with OK."}},
		"stream":      false,
		"temperature": 0,
		"max_tokens":  16,
	})
	recorder := httptest.NewRecorder()
	inner, _ := gin.CreateTestContext(recorder)
	if timeout <= 0 {
		timeout = healthProbeTimeout
	}
	probeCtx, cancel := context.WithTimeout(parent.Request.Context(), timeout)
	defer cancel()
	inner.Request = parent.Request.Clone(probeCtx)
	inner.Request.Method = http.MethodPost
	inner.Request.URL.Path = "/v1/chat/completions"
	inner.Request.Body = io.NopCloser(bytes.NewReader(body))
	inner.Request.ContentLength = int64(len(body))
	inner.Request.Header = parent.Request.Header.Clone()
	inner.Request.Header.Set("Content-Type", "application/json")
	inner.Set("api_key_id", 0)
	inner.Set("billing_require_known", false)
	inner.Set("request_source", model.RelayLogRequestSourceHealthCheck)
	inner.Header("X-Octopus-Request-Source", model.RelayLogRequestSourceHealthCheck)
	inner.Header("X-Octopus-Request-ID", requestID)

	if groupOverride != nil {
		relay.SetExecutionPreferredKey(inner, preferredKeyID)
		relay.ExecuteDirectWithGroup(inbound.InboundTypeOpenAIChat, inner, *groupOverride)
	} else {
		relay.Handler(inbound.InboundTypeOpenAIChat, inner)
	}

	status := recorder.Code
	if probeCtx.Err() == context.DeadlineExceeded {
		status = http.StatusGatewayTimeout
	} else if status == 0 {
		status = http.StatusOK
	}
	completion, validationErr := validateHealthCompletion(status, recorder.Body.Bytes())
	success := validationErr == nil
	actualModel := strings.TrimSpace(completion.Model)
	if actualModel == "" {
		actualModel = recorder.Header().Get("X-Octopus-Remote-Model")
	}
	result := executionHealthResult{
		Success:        success,
		LatencyMS:      time.Since(started).Milliseconds(),
		RequestedModel: requestModel,
		ActualModel:    actualModel,
		RemoteModel:    recorder.Header().Get("X-Octopus-Remote-Model"),
		ChannelName:    recorder.Header().Get("X-Octopus-Channel-Name"),
		RequestID:      requestID,
		StatusCode:     status,
	}
	result.Attempts = relay.ExecutionAttempts(inner)
	for i := range result.Attempts {
		result.Attempts[i].Msg = sanitizeExecutionError(result.Attempts[i].Msg)
	}
	if channelID, err := strconv.Atoi(recorder.Header().Get("X-Octopus-Channel-ID")); err == nil {
		result.ChannelID = channelID
	}
	if !success {
		detail := relay.ExecutionError(inner)
		if detail == "" && validationErr != nil && status >= http.StatusOK && status < http.StatusMultipleChoices {
			detail = validationErr.Error()
		}
		if detail == "" {
			detail = recorder.Body.String()
		}
		result.Error = sanitizeExecutionError(detail)
	}
	return result
}

func validateHealthCompletion(status int, body []byte) (healthCompletionPayload, error) {
	var completion healthCompletionPayload
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return completion, fmt.Errorf("upstream returned HTTP %d", status)
	}
	if err := json.Unmarshal(body, &completion); err != nil {
		return completion, fmt.Errorf("upstream returned invalid JSON: %w", err)
	}
	if len(completion.Error) > 0 && string(completion.Error) != "null" {
		return completion, fmt.Errorf("upstream returned an error response")
	}
	if len(completion.Choices) == 0 {
		return completion, fmt.Errorf("upstream returned no completion choices")
	}
	if !validHealthCompletionChoice(completion.Choices[0]) {
		return completion, fmt.Errorf("upstream returned an invalid completion choice")
	}
	return completion, nil
}

func validHealthCompletionChoice(choice healthCompletionChoice) bool {
	if choice.Text != nil {
		return true
	}
	if len(choice.Message) == 0 || string(choice.Message) == "null" {
		return false
	}
	var message struct {
		Content          json.RawMessage   `json:"content"`
		ToolCalls        []json.RawMessage `json:"tool_calls"`
		Refusal          *string           `json:"refusal"`
		ReasoningContent *string           `json:"reasoning_content"`
	}
	if err := json.Unmarshal(choice.Message, &message); err != nil {
		return false
	}
	if len(message.ToolCalls) > 0 || message.Refusal != nil || message.ReasoningContent != nil {
		return true
	}
	if len(message.Content) == 0 || string(message.Content) == "null" {
		return false
	}
	var text string
	if json.Unmarshal(message.Content, &text) == nil {
		return true
	}
	var blocks []json.RawMessage
	return json.Unmarshal(message.Content, &blocks) == nil
}

func directExecutionGroup(channelID int, modelName string) model.Group {
	return model.Group{
		ID:    -channelID,
		Name:  modelName,
		Mode:  model.GroupModeFailover,
		Items: []model.GroupItem{{ChannelID: channelID, ModelName: modelName, Priority: 1, Weight: 1}},
	}
}

func channelHasModel(channel *model.Channel, modelName string) bool {
	if channel == nil || strings.TrimSpace(modelName) == "" {
		return false
	}
	for _, raw := range []string{channel.Model, channel.CustomModel} {
		for _, candidate := range strings.Split(raw, ",") {
			if strings.TrimSpace(candidate) == modelName {
				return true
			}
		}
	}
	return false
}

func sanitizeExecutionError(raw string) string {
	raw = strings.TrimSpace(secretPattern.ReplaceAllString(raw, "[REDACTED]"))
	if len(raw) > 1200 {
		raw = raw[:1200] + "..."
	}
	return raw
}

func tryAcquire(slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	default:
		return false
	}
}

func release(slots chan struct{}) {
	<-slots
}

func enforceAdminRateLimit(c *gin.Context, key, maxRPM int) bool {
	allowed, retryAfter := op.RateLimitCheck(key, maxRPM)
	if allowed {
		return true
	}
	c.Header("Retry-After", strconv.Itoa(retryAfter))
	respondPlaygroundError(
		c,
		http.StatusTooManyRequests,
		codePlaygroundRateLimited,
		"too many admin test requests",
		map[string]any{"retryAfter": retryAfter, "maxRPM": maxRPM},
	)
	return false
}
