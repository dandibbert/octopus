package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/bestruirui/octopus/internal/helper"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/rewrite"
	"github.com/bestruirui/octopus/internal/server/middleware"
	"github.com/bestruirui/octopus/internal/server/resp"
	"github.com/bestruirui/octopus/internal/server/router"
	"github.com/bestruirui/octopus/internal/transformer/inbound"
	transformerModel "github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/gin-gonic/gin"
)

const previewSentinelKey = "octopus-preview-placeholder"

func init() {
	router.NewGroupRouter("/api/v1/rewrite").
		Use(middleware.Auth()).
		Use(middleware.RequireJSON()).
		AddRoute(
			router.NewRoute("/validate", http.MethodPost).
				Handle(validateRewrite),
		).
		AddRoute(
			router.NewRoute("/preview", http.MethodPost).
				Handle(previewRewrite),
		)
}

type rewriteValidateRequest struct {
	Scope  rewrite.Scope   `json:"scope"`
	Config json.RawMessage `json:"config"`
}

type rewritePreviewRequest struct {
	ChannelID     int               `json:"channel_id"`
	GroupID       int               `json:"group_id"`
	InboundFormat string            `json:"inbound_format"`
	Path          string            `json:"path"`
	Body          json.RawMessage   `json:"body"`
	Headers       map[string]string `json:"headers"`
	DraftScope    rewrite.Scope     `json:"draft_scope"`
	DraftConfig   json.RawMessage   `json:"draft_config"`
}

func validateRewrite(c *gin.Context) {
	var req rewriteValidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	scope := req.Scope
	if scope == "" {
		scope = rewrite.ScopeChannel
	}
	raw := string(req.Config)
	result, err := rewrite.ValidateRawConfig(&raw, scope)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	legacy := false
	warnings := []string{}
	if result != nil {
		legacy = result.Legacy
		warnings = result.Warnings
	}
	resp.Success(c, gin.H{
		"ok":       true,
		"legacy":   legacy,
		"warnings": warnings,
	})
}

func previewRewrite(c *gin.Context) {
	var req rewritePreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		resp.InvalidJSON(c)
		return
	}
	if req.ChannelID <= 0 {
		resp.Error(c, http.StatusBadRequest, "channel_id is required")
		return
	}
	channel, err := op.ChannelGet(req.ChannelID, c.Request.Context())
	if err != nil {
		resp.Error(c, http.StatusNotFound, "channel not found")
		return
	}

	inboundType := inboundTypeFromFormat(req.InboundFormat)
	inAdapter := inbound.Get(inboundType)
	if inAdapter == nil {
		resp.Error(c, http.StatusBadRequest, "unsupported inbound_format")
		return
	}
	outAdapter := outbound.Get(channel.Type)
	if outAdapter == nil {
		resp.Error(c, http.StatusBadRequest, "unsupported channel type")
		return
	}

	inboundRaw := []byte(req.Body)
	if len(inboundRaw) == 0 {
		inboundRaw = []byte(`{}`)
	}
	internalReq, err := inAdapter.TransformRequest(c.Request.Context(), inboundRaw)
	if err != nil {
		resp.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if req.Path != "" && internalReq != nil {
		internalReq.Query = nil
	}

	var group *model.Group
	groupID := req.GroupID
	applyGroup := groupID > 0
	if applyGroup {
		loaded, gerr := op.GroupGet(groupID, c.Request.Context())
		if gerr != nil {
			resp.Error(c, http.StatusNotFound, "group not found")
			return
		}
		group = loaded
	}

	result, err := previewOutbound(c.Request.Context(), previewOutboundInput{
		Request:     req,
		Channel:     channel,
		Group:       group,
		ApplyGroup:  applyGroup,
		InboundRaw:  inboundRaw,
		InternalReq: internalReq,
		OutAdapter:  outAdapter,
	})
	if err != nil {
		resp.Error(c, rewriteStatusFromErr(err), err.Error())
		return
	}
	resp.Success(c, result)
}

type previewOutboundInput struct {
	Request     rewritePreviewRequest
	Channel     *model.Channel
	Group       *model.Group
	ApplyGroup  bool
	InboundRaw  []byte
	InternalReq *transformerModel.InternalLLMRequest
	OutAdapter  transformerModel.Outbound
}

func previewOutbound(ctx context.Context, in previewOutboundInput) (gin.H, error) {
	channel := in.Channel
	req := in.Request
	groupID := 0
	if in.Group != nil {
		groupID = in.Group.ID
	}
	if req.GroupID > 0 {
		groupID = req.GroupID
	}

	groupRaw := (*string)(nil)
	var groupHeaders []model.CustomHeader
	if in.ApplyGroup && in.Group != nil {
		groupRaw = in.Group.ParamOverride
		groupHeaders = in.Group.CustomHeader
	}

	channelRaw := channel.ParamOverride
	if len(req.DraftConfig) > 0 && string(req.DraftConfig) != "null" {
		draft := string(req.DraftConfig)
		switch req.DraftScope {
		case rewrite.ScopeGroup:
			groupRaw = &draft
		default:
			channelRaw = &draft
		}
	}

	httpReq, err := in.OutAdapter.TransformRequest(ctx, in.InternalReq, channel.GetBaseUrl(), previewSentinelKey)
	if err != nil {
		return nil, err
	}
	helper.ApplyCustomHeaders(httpReq.Header, helper.MergeCustomHeaders(groupHeaders, channel.CustomHeader))
	if httpReq.Header.Get("User-Agent") == "" {
		httpReq.Header.Set("User-Agent", "")
	}
	if req.Headers != nil {
		for k, v := range req.Headers {
			httpReq.Header.Set(k, v)
		}
	}

	beforeBody, _ := io.ReadAll(httpReq.Body)
	httpReq.Body = io.NopCloser(strings.NewReader(string(beforeBody)))
	httpReq.ContentLength = int64(len(beforeBody))
	beforeHeaders := redactHeaderMap(httpReq.Header.Clone())

	groupPlan, err := rewrite.ParseAndCompile(groupRaw, rewrite.ScopeGroup)
	if err != nil {
		return nil, err
	}
	channelPlan, err := rewrite.ParseAndCompile(channelRaw, rewrite.ScopeChannel)
	if err != nil {
		return nil, err
	}

	rwCtx := previewContext(req, channel, groupID, in.InternalReq.Model)
	inbound := http.Header{}
	for k, v := range req.Headers {
		inbound.Set(k, v)
	}

	afterGroupBody := append([]byte(nil), beforeBody...)
	afterGroupHeaders := beforeHeaders
	if in.ApplyGroup && groupPlan != nil {
		groupRes, aerr := rewrite.Apply(rewrite.Input{
			Body:           append([]byte(nil), beforeBody...),
			Headers:        httpReq.Header.Clone(),
			InboundHeaders: inbound.Clone(),
			Context:        rwCtx,
			Transport:      rewrite.TransportHTTP,
		}, groupPlan)
		if aerr != nil {
			return nil, aerr
		}
		afterGroupBody = groupRes.Body
		afterGroupHeaders = redactHeaderMap(groupRes.Headers)
	}

	plans := []*rewrite.Plan{channelPlan}
	if in.ApplyGroup {
		plans = []*rewrite.Plan{groupPlan, channelPlan}
	}
	finalRes, err := rewrite.PrepareRequest(httpReq, rewrite.TransportHTTP, rwCtx, inbound, plans...)
	if err != nil {
		return nil, err
	}
	if finalRes == nil {
		finalRes = &rewrite.Result{Body: afterGroupBody, Headers: httpReq.Header}
	}
	if len(finalRes.Body) == 0 {
		finalBody, _ := io.ReadAll(httpReq.Body)
		httpReq.Body = io.NopCloser(strings.NewReader(string(finalBody)))
		finalRes.Body = finalBody
	}

	return gin.H{
		"stage":         rewrite.StageOutboundProvider,
		"target_format": outboundFormatNameHandler(channel.Type),
		"stages": gin.H{
			"inbound_raw":             json.RawMessage(in.InboundRaw),
			"outbound_before_rewrite": json.RawMessage(beforeBody),
			"after_group":             json.RawMessage(afterGroupBody),
			"after_channel":           json.RawMessage(finalRes.Body),
			"final_body":              json.RawMessage(redactPreviewBody(finalRes.Body)),
			"final_headers":           redactHeaderMap(httpReq.Header),
			"before_headers":          beforeHeaders,
			"after_group_headers":     afterGroupHeaders,
		},
		"trace":    redactTrace(finalRes.Trace),
		"warnings": []string{},
		"summary":  finalRes.Summary,
	}, nil
}

func rewriteStatusFromErr(err error) int {
	if ae, ok := err.(*rewrite.ApplyError); ok && ae.StatusCode > 0 {
		return ae.StatusCode
	}
	return http.StatusBadRequest
}

func inboundTypeFromFormat(format string) inbound.InboundType {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "openai_responses", "openai_response":
		return inbound.InboundTypeOpenAIResponse
	case "anthropic_messages", "anthropic":
		return inbound.InboundTypeAnthropic
	case "openai_embedding":
		return inbound.InboundTypeOpenAIEmbedding
	default:
		return inbound.InboundTypeOpenAIChat
	}
}

func outboundFormatNameHandler(channelType outbound.OutboundType) string {
	switch channelType {
	case outbound.OutboundTypeOpenAIChat:
		return "openai_chat"
	case outbound.OutboundTypeOpenAIResponse:
		return "openai_responses"
	case outbound.OutboundTypeAnthropic:
		return "anthropic_messages"
	case outbound.OutboundTypeGemini:
		return "gemini"
	case outbound.OutboundTypeVolcengine:
		return "volcengine"
	case outbound.OutboundTypeOpenAIEmbedding:
		return "openai_embedding"
	default:
		return "unknown"
	}
}

func previewContext(req rewritePreviewRequest, channel *model.Channel, groupID int, modelName string) rewrite.Context {
	return rewrite.Context{
		RequestOriginalModel:             modelName,
		RequestNormalizedModel:           modelName,
		RequestPath:                      req.Path,
		RequestMethod:                    http.MethodPost,
		RequestSource:                    "preview",
		RouteRoutedModel:                 modelName,
		RouteTransportModelBeforeRewrite: modelName,
		RouteInboundFormat:               req.InboundFormat,
		RouteOutboundFormat:              outboundFormatNameHandler(channel.Type),
		RouteChannelID:                   channel.ID,
		RouteChannelName:                 channel.Name,
		RouteGroupID:                     groupID,
		FlagsIsPlayground:                false,
	}
}

func redactHeaderMap(h http.Header) map[string]string {
	out := map[string]string{}
	if h == nil {
		return out
	}
	for name := range h {
		val := strings.Join(h.Values(name), ", ")
		if rewrite.RedactHeaderValue(name, val) == "***" {
			out[name] = "***"
			continue
		}
		lower := strings.ToLower(name)
		if strings.Contains(lower, "authorization") || strings.Contains(lower, "api-key") || strings.Contains(lower, "cookie") {
			out[name] = "***"
			continue
		}
		out[name] = val
	}
	return out
}

func redactPreviewBody(body []byte) []byte {
	return body
}

func redactTrace(trace []rewrite.TraceEntry) []rewrite.TraceEntry {
	return trace
}
