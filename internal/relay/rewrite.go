package relay

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	dbmodel "github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/rewrite"
	transformerModel "github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

func isSyntheticGroup(groupID int) bool {
	return groupID <= 0
}

func (ra *relayAttempt) rewritePlans() (*rewrite.Plan, *rewrite.Plan, error) {
	var groupPlan *rewrite.Plan
	var err error
	if !ra.directExecution && !isSyntheticGroup(ra.groupID) {
		groupPlan, err = rewrite.CompileCached(ra.groupParamOverride, rewrite.ScopeGroup)
		if err != nil {
			return nil, nil, rewrite.ConfigCompileError(err)
		}
	}
	var channelRaw *string
	if ra.channel != nil {
		channelRaw = ra.channel.ParamOverride
	}
	channelPlan, err := rewrite.CompileCached(channelRaw, rewrite.ScopeChannel)
	if err != nil {
		return nil, nil, rewrite.ConfigCompileError(err)
	}
	return groupPlan, channelPlan, nil
}

func (ra *relayAttempt) rewriteContext(transport rewrite.Transport) rewrite.Context {
	ctx := rewrite.Context{
		RequestOriginalModel:   ra.requestModel,
		RequestNormalizedModel: ra.requestModel,
		RequestSource:          ra.metrics.RequestSource,
		RouteChannelID:         ra.channel.ID,
		RouteChannelName:       ra.channel.Name,
		RouteChannelType:       outboundFormatName(ra.channel.Type),
		RouteGroupID:           ra.groupID,
		RouteGroupName:         ra.groupName,
		RetryIndex:             ra.retryIndex,
		RetryIsRetry:           ra.retryIndex > 0,
		RetryLastErrorStatus:   ra.retryLastStatus,
		AuthAPIKeyID:           ra.apiKeyID,
		FlagsIsChannelTest:     ra.directExecution && ra.metrics.RequestSource != dbmodel.RelayLogRequestSourcePlayground,
		FlagsIsHealthCheck:     ra.metrics.RequestSource == dbmodel.RelayLogRequestSourceHealthCheck,
		FlagsIsPlayground:      ra.metrics.RequestSource == dbmodel.RelayLogRequestSourcePlayground,
	}
	if ra.internalRequest != nil {
		ctx.RouteRoutedModel = ra.internalRequest.Model
		ctx.RouteTransportModelBeforeRewrite = ra.internalRequest.Model
		ctx.RouteInboundFormat = string(ra.internalRequest.RawAPIFormat)
		ctx.RequestReasoningEffort = ra.internalRequest.ReasoningEffort
		if len(ra.internalRequest.Metadata) > 0 {
			ctx.RequestMetadata = make(map[string]string, len(ra.internalRequest.Metadata))
			for key, value := range ra.internalRequest.Metadata {
				ctx.RequestMetadata[key] = value
			}
		}
		if ra.internalRequest.Stream != nil {
			ctx.RequestStream = *ra.internalRequest.Stream
		}
		if ra.c != nil && ra.c.Request != nil {
			ctx.RequestPath = ra.c.Request.URL.Path
			ctx.RequestMethod = ra.c.Request.Method
		}
	}
	if ra.retryLastErr != nil {
		var applyErr *rewrite.ApplyError
		if errors.As(ra.retryLastErr, &applyErr) && applyErr != nil {
			ctx.RetryLastErrorCode = applyErr.Code
			ctx.RetryLastErrorType = applyErr.Type
		}
	}
	ctx.RouteOutboundFormat = outboundFormatName(ra.channel.Type)
	_ = transport
	return ctx
}

func outboundFormatName(channelType outbound.OutboundType) string {
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
		return strconv.Itoa(int(channelType))
	}
}

func (ra *relayAttempt) prepareOutboundRequest(req *http.Request, transport rewrite.Transport) (*rewrite.Result, error) {
	if req == nil {
		return &rewrite.Result{}, nil
	}
	ra.copyHeaders(req)
	if ra.channel != nil && ra.channel.Type == outbound.OutboundTypeOpenAIResponse {
		req.Header.Set("Content-Type", "application/json")
	}
	groupPlan, channelPlan, err := ra.rewritePlans()
	if err != nil {
		return nil, err
	}
	inbound := http.Header{}
	if ra.c != nil && ra.c.Request != nil {
		inbound = ra.c.Request.Header.Clone()
	}
	result, err := rewrite.PrepareRequest(req, transport, ra.rewriteContext(transport), inbound, groupPlan, channelPlan)
	if err != nil {
		return result, mapRewriteError(err)
	}
	if result != nil {
		if requestBody, readErr := readOutboundRequestBody(req); readErr == nil {
			ra.metrics.SetTransportRequestPayload(requestBody, ra.internalRequest.Model)
			if model := gjson.GetBytes(requestBody, "model"); model.Exists() && model.Type == gjson.String {
				result.Summary.TransportModel = model.String()
			}
		}
		ra.metrics.RewriteSummary = result.Summary
		if result.Changed {
			log.Debugw("relay.rewrite",
				"group_hash", result.Summary.GroupConfigHash,
				"channel_hash", result.Summary.ChannelConfigHash,
				"applied", result.Summary.Applied,
				"skipped", result.Summary.Skipped,
				"transport_model", result.Summary.TransportModel,
			)
		}
	}
	return result, nil
}

func (ra *relayAttempt) applyRewriteToBytes(body []byte, headers http.Header, transport rewrite.Transport) ([]byte, http.Header, error) {
	groupPlan, channelPlan, err := ra.rewritePlans()
	if err != nil {
		return nil, headers, err
	}
	inbound := http.Header{}
	if ra.c != nil && ra.c.Request != nil {
		inbound = ra.c.Request.Header.Clone()
	}
	result, err := rewrite.Apply(rewrite.Input{
		Body:           body,
		Headers:        headers,
		InboundHeaders: inbound,
		Context:        ra.rewriteContext(transport),
		Transport:      transport,
	}, groupPlan, channelPlan)
	if err != nil {
		return result.Body, result.Headers, mapRewriteError(err)
	}
	ra.metrics.RewriteSummary = result.Summary
	if model := gjson.GetBytes(result.Body, "model"); model.Exists() && model.Type == gjson.String {
		result.Summary.TransportModel = model.String()
		ra.metrics.RewriteSummary.TransportModel = model.String()
	}
	return result.Body, result.Headers, nil
}

func mapRewriteError(err error) error {
	if err == nil {
		return nil
	}
	if ae, ok := err.(*rewrite.ApplyError); ok {
		return ae
	}
	return err
}

func rewriteStatusCode(err error) int {
	if ae, ok := err.(*rewrite.ApplyError); ok && ae.StatusCode > 0 {
		return ae.StatusCode
	}
	return http.StatusBadRequest
}

func (ra *relayAttempt) prepareWSHandshakeHeaders() http.Header {
	client := ra.clientRequestHeaders()
	key := ""
	if ra.usedKey.ChannelKey != "" {
		key = ra.usedKey.ChannelKey
	}
	return buildUpstreamWSHeaders(client, ra.channel, key)
}

func (ra *relayAttempt) wsHandshakeOrDefault() http.Header {
	if ra.wsFinalHeaders != nil {
		return ra.wsFinalHeaders
	}
	return ra.prepareWSHandshakeHeaders()
}

func shaHeaderSig(sig string) string {
	if sig == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(sig))
	return hex.EncodeToString(sum[:])
}

func writeRewriteApplyError(c *gin.Context, hb *earlyHeartbeat, in transformerModel.Inbound, rawFormat transformerModel.APIFormat, err error) {
	var applyErr *rewrite.ApplyError
	if !errors.As(err, &applyErr) || applyErr == nil {
		writeInboundError(c, hb, in, rewriteStatusCode(err), err.Error())
		return
	}
	if c == nil {
		return
	}
	status := applyErr.StatusCode
	if status <= 0 {
		status = http.StatusBadRequest
	}
	if c.Writer != nil && c.Writer.Written() {
		writeInboundError(c, hb, in, status, applyErr.PublicMessage)
		return
	}
	var payload any
	if rawFormat == transformerModel.APIFormatAnthropicMessage {
		payload = map[string]any{
			"type": "error",
			"error": map[string]any{
				"type":    applyErr.Type,
				"message": applyErr.PublicMessage,
			},
		}
	} else {
		payload = map[string]any{
			"error": map[string]any{
				"message": applyErr.PublicMessage,
				"type":    applyErr.Type,
				"code":    applyErr.Code,
			},
		}
	}
	body, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		writeInboundError(c, hb, in, status, applyErr.PublicMessage)
		return
	}
	c.Data(status, "application/json; charset=utf-8", body)
}
