package relay

import (
	"context"
	"encoding/json"
	"time"

	"github.com/bestruirui/octopus/internal/conf"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/price"
	"github.com/bestruirui/octopus/internal/rewrite"
	transformerModel "github.com/bestruirui/octopus/internal/transformer/model"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/bestruirui/octopus/internal/utils/tokenizer"
)

// RelayMetrics 负责最终的日志收集与持久化
type RelayMetrics struct {
	APIKeyID      int
	RequestModel  string
	RequestSource string
	RequestID     string
	StartTime     time.Time

	// 首 Token 时间
	FirstTokenTime time.Time

	// 请求和响应内容
	RawRequest       []byte
	InternalRequest  *transformerModel.InternalLLMRequest
	InternalResponse *transformerModel.InternalLLMResponse

	// 统计指标
	ActualModel string
	Stats       model.StatsMetrics
	UsedWS      bool
	WSMode      *model.RelayLogWSMode
	WSExecMode  *model.RelayLogWSExecMode
	WSRecovery  *model.RelayLogWSRecovery

	TransportInputTokens *int
	BillInputTokens      *int
	CacheReadTokens      *int
	CacheWriteTokens     *int

	BillingPlan      *model.BillingPlan
	ActualResolution model.ModelResolution
	BilledPrice      model.PriceResolution
	ProviderPrice    model.PriceResolution
	UsageEstimated   bool
	PriceEstimated   bool
	ModelMismatch    bool
	RewriteSummary   rewrite.Summary
}

func NewRelayMetrics(apiKeyID int, requestModel string, rawBody []byte, req *transformerModel.InternalLLMRequest) *RelayMetrics {
	return &RelayMetrics{
		APIKeyID:        apiKeyID,
		RequestModel:    requestModel,
		StartTime:       time.Now(),
		RawRequest:      rawBody,
		InternalRequest: req,
	}
}

func (m *RelayMetrics) SetFirstTokenTime(t time.Time) {
	m.FirstTokenTime = t
}

func (m *RelayMetrics) SetTransportRequestPayload(payload []byte, modelName string) {
	if len(payload) == 0 {
		return
	}
	count := tokenizer.CountTokens(string(payload), modelName)
	m.TransportInputTokens = intPtr(count)
}

func (m *RelayMetrics) SetWSMode(mode model.RelayLogWSMode) {
	if mode == "" {
		return
	}
	m.WSMode = wsModePtr(mode)
}

func (m *RelayMetrics) SetWSExecMode(mode model.RelayLogWSExecMode) {
	if mode == "" {
		return
	}
	m.WSExecMode = wsExecModePtr(mode)
}

func (m *RelayMetrics) SetWSRecovery(recovery model.RelayLogWSRecovery) {
	if recovery == "" {
		return
	}
	m.WSRecovery = wsRecoveryPtr(recovery)
}

func (m *RelayMetrics) SetBillingRoute(channel model.Channel, item model.GroupItem, requireKnown bool) error {
	plan, err := price.BuildBillingPlan(m.RequestModel, channel, item, requireKnown)
	m.BillingPlan = &plan
	return err
}

func (m *RelayMetrics) SetInternalResponse(resp *transformerModel.InternalLLMResponse, actualModel string) {
	m.InternalResponse = resp
	m.ActualModel = actualModel

	if resp == nil {
		return
	}

	inputReported := false
	if usage := resp.Usage; usage != nil {
		nonCachedInput := usage.BillableNonCachedInput()
		cacheReadTokens := usage.BillableCacheReadInput()
		cacheWriteTokens := usage.BillableCacheWriteInput()

		m.BillInputTokens = intPtr(int(nonCachedInput))
		m.CacheReadTokens = intPtr(int(cacheReadTokens))
		m.CacheWriteTokens = intPtr(int(cacheWriteTokens))
		m.Stats.InputToken = usage.PromptTokens
		m.Stats.OutputToken = usage.CompletionTokens
		inputReported = usage.EffectiveInputTokens() > 0

	}

	// 降级：上游未上报 input（usage 缺失，或 usage 中输入侧全为 0）时，用请求侧
	// 估算的 TransportInputTokens 兜底，使 input token/费用不为 0；output 无法从
	// 请求侧估算，保持 0。tiktoken 统一用 o200k_base，对 Claude/Gemini 为近似值。
	if !inputReported && m.TransportInputTokens != nil && *m.TransportInputTokens > 0 {
		estimated := int64(*m.TransportInputTokens)
		m.Stats.InputToken = estimated
		m.BillInputTokens = intPtr(int(estimated))
		m.UsageEstimated = true
	}
	m.applyBillingCosts()
}

func (m *RelayMetrics) applyBillingCosts() {
	nonCachedInput := int64(pointerInt(m.BillInputTokens))
	cacheRead := int64(pointerInt(m.CacheReadTokens))
	cacheWrite := int64(pointerInt(m.CacheWriteTokens))
	output := m.Stats.OutputToken

	if m.BillingPlan != nil {
		m.ActualResolution, m.ProviderPrice, m.BilledPrice, m.ModelMismatch = price.ResolveFinalBilling(*m.BillingPlan, m.ActualModel)
	} else {
		m.ActualResolution = price.ResolveModelIdentity(model.ModelResolveContext{RawModel: m.ActualModel, Purpose: "actual"})
		m.ProviderPrice = price.ResolvePrice(m.ActualResolution)
		m.BilledPrice = m.ProviderPrice
	}

	billed := price.CalculateCost(nonCachedInput, cacheRead, cacheWrite, output, m.BilledPrice)
	provider := price.CalculateCost(nonCachedInput, cacheRead, cacheWrite, output, m.ProviderPrice)
	m.Stats.InputCost = billed.Input
	m.Stats.OutputCost = billed.Output
	m.Stats.ProviderInputCost = provider.Input
	m.Stats.ProviderOutputCost = provider.Output
	m.PriceEstimated = m.BilledPrice.Estimated || m.ProviderPrice.Estimated || m.ActualResolution.Estimated

	if m.BilledPrice.Status == model.BillingStatusUnknown {
		m.Stats.UnknownPriceRequests = 1
		m.Stats.UnknownPriceInputTokens = m.Stats.InputToken
		m.Stats.UnknownPriceOutputTokens = m.Stats.OutputToken
	}
	if m.BilledPrice.Method == "route_fallback" || m.ProviderPrice.Method == "route_fallback" {
		m.Stats.RouteFallbackRequests = 1
	}
	if m.ModelMismatch {
		m.Stats.ModelMismatchRequests = 1
	}
}

func (m *RelayMetrics) Save(ctx context.Context, success bool, err error, attempts []model.ChannelAttempt) {
	m.SaveWithChannelStats(ctx, success, err, attempts, true)
}

func (m *RelayMetrics) SaveWithChannelStats(ctx context.Context, success bool, err error, attempts []model.ChannelAttempt, updateChannelStats bool) {
	duration := time.Since(m.StartTime)

	globalStats := m.Stats
	globalStats.WaitTime = duration.Milliseconds()
	if success {
		globalStats.RequestSuccess = 1
	} else {
		globalStats.RequestFailed = 1
	}

	channelID, channelName := finalChannel(attempts)
	// Playground 与测活是真实上游请求，费用和 Token 仍写入 RelayLog；
	// 但业务 Usage 聚合只统计普通 API 流量，避免成功率、额度和 API Key 维度失真。
	if m.shouldAggregateStats() {
		op.StatsTotalUpdate(globalStats)
		op.StatsHourlyUpdate(globalStats)
		op.StatsDailyUpdate(context.Background(), globalStats)
		if m.APIKeyID > 0 {
			op.StatsAPIKeyUpdate(m.APIKeyID, globalStats)
		}
		if updateChannelStats {
			// Requests that fail before selecting/attempting a channel have
			// channelID=0. They belong in global stats only; attributing them to
			// StatsChannel would let an auto-increment stats PK remap zero onto a
			// real channel ID in existing databases.
			if channelID > 0 {
				op.StatsChannelUpdate(channelID, globalStats)
			}
		} else {
			updateFinalChannelUsageStats(channelID, globalStats)
		}
		op.StatsSiteModelHourlyRecordAttempts(attempts, m.ActualModel)
	}

	// 上游未上报 usage（或输入侧全为 0）时打告警，便于定位是哪个通道缺失 usage。
	if success && (m.InternalResponse == nil || m.InternalResponse.Usage == nil ||
		m.InternalResponse.Usage.EffectiveInputTokens() == 0) {
		fallbackInput := 0
		if m.TransportInputTokens != nil {
			fallbackInput = *m.TransportInputTokens
		}
		log.Debugw("relay.usage_missing",
			"actual_model", m.ActualModel,
			"channel_id", channelID,
			"channel", channelName,
			"had_usage", m.InternalResponse != nil && m.InternalResponse.Usage != nil,
			"fallback_input_tokens", fallbackInput,
		)
	}

	if conf.AppConfig.Log.Relay.Summary || !success {
		fields := []interface{}{
			"model", m.RequestModel,
			"actual_model", m.ActualModel,
			"channel_id", channelID,
			"channel", channelName,
			"success", success,
			"duration_ms", duration.Milliseconds(),
			"input_token", m.Stats.InputToken,
			"output_token", m.Stats.OutputToken,
			"input_cost", m.Stats.InputCost,
			"output_cost", m.Stats.OutputCost,
			"total_cost", m.Stats.InputCost + m.Stats.OutputCost,
			"provider_cost", m.Stats.ProviderInputCost + m.Stats.ProviderOutputCost,
			"billing_status", m.BilledPrice.Status,
			"provider_cost_status", m.ProviderPrice.Status,
			"billing_basis", billingBasis(m.BillingPlan),
			"billing_class_id", m.BilledPrice.BillingClassID,
			"billing_resolution", m.BilledPrice.Method,
			"price_estimated", m.PriceEstimated,
			"model_mismatch", m.ModelMismatch,
			"attempts", len(attempts),
			"ws", m.UsedWS,
		}
		if success {
			log.Infow("relay.complete", fields...)
		} else {
			log.Warnw("relay.complete", fields...)
		}
	}

	m.saveLog(ctx, success, err, duration, attempts, channelID, channelName)
}

func (m *RelayMetrics) shouldAggregateStats() bool {
	return m.RequestSource == "" || m.RequestSource == model.RelayLogRequestSourceAPI
}

func finalChannel(attempts []model.ChannelAttempt) (int, string) {
	var lastID int
	var lastName string
	for i := len(attempts) - 1; i >= 0; i-- {
		a := attempts[i]
		if a.Status == model.AttemptSuccess {
			return a.ChannelID, a.ChannelName
		}
		if a.Status == model.AttemptFailed && lastID == 0 {
			lastID = a.ChannelID
			lastName = a.ChannelName
		}
	}
	return lastID, lastName
}

func (m *RelayMetrics) saveLog(ctx context.Context, success bool, err error, duration time.Duration, attempts []model.ChannelAttempt, channelID int, channelName string) {
	actualModel := m.ActualModel
	if actualModel == "" {
		actualModel = m.RequestModel
	}

	relayLog := model.RelayLog{
		Time:              m.StartTime.Unix(),
		RequestModelName:  m.RequestModel,
		RequestSource:     m.RequestSource,
		RequestID:         m.RequestID,
		ChannelName:       channelName,
		ChannelId:         channelID,
		ActualModelName:   actualModel,
		ActualCanonicalID: m.ActualResolution.CanonicalModelID,
		UseTime:           int(duration.Milliseconds()),
		Attempts:          attempts,
		TotalAttempts:     len(attempts),
		UsedWS:            m.UsedWS,
	}
	if m.BillingPlan != nil {
		relayLog.RoutedModelName = m.BillingPlan.RoutedModel
		relayLog.RequestedCanonicalID = m.BillingPlan.RequestedResolution.CanonicalModelID
		relayLog.RoutedCanonicalID = m.BillingPlan.RoutedResolution.CanonicalModelID
		relayLog.BillingBasis = m.BillingPlan.Basis
	}
	relayLog.BillingClassID = m.BilledPrice.BillingClassID
	relayLog.BillingResolutionMethod = m.BilledPrice.Method
	relayLog.BillingPriceSource = m.BilledPrice.PriceSource
	relayLog.BillingPriceVersion = m.BilledPrice.PriceVersion
	relayLog.BillingPriceMode = m.BilledPrice.PriceMode
	relayLog.BillingCostStatus = m.BilledPrice.Status
	relayLog.ProviderBillingClassID = m.ProviderPrice.BillingClassID
	relayLog.ProviderResolutionMethod = m.ProviderPrice.Method
	relayLog.ProviderPriceSource = m.ProviderPrice.PriceSource
	relayLog.ProviderPriceVersion = m.ProviderPrice.PriceVersion
	relayLog.ProviderCostStatus = m.ProviderPrice.Status
	relayLog.UsageEstimated = m.UsageEstimated
	relayLog.PriceEstimated = m.PriceEstimated
	relayLog.ModelMismatch = m.ModelMismatch

	if apiKey, getErr := op.APIKeyGet(m.APIKeyID, ctx); getErr == nil {
		relayLog.RequestAPIKeyName = apiKey.Name
	}

	// 首字时间
	if !m.FirstTokenTime.IsZero() {
		relayLog.Ftut = int(m.FirstTokenTime.Sub(m.StartTime).Milliseconds())
	}

	// Usage：统一从 Stats 读取。Stats 在 SetInternalResponse 中已由上游 usage 填充，
	// 或在 usage 缺失时由 TransportInputTokens 降级填充，确保降级值也写入日志。
	relayLog.InputTokens = int(m.Stats.InputToken)
	relayLog.OutputTokens = int(m.Stats.OutputToken)
	relayLog.Cost = m.Stats.InputCost + m.Stats.OutputCost
	relayLog.InputCost = m.Stats.InputCost
	relayLog.OutputCost = m.Stats.OutputCost
	relayLog.ProviderInputCost = m.Stats.ProviderInputCost
	relayLog.ProviderOutputCost = m.Stats.ProviderOutputCost
	relayLog.ProviderCost = m.Stats.ProviderInputCost + m.Stats.ProviderOutputCost
	relayLog.TransportInputTokens = m.TransportInputTokens
	relayLog.BillInputTokens = m.BillInputTokens
	relayLog.CacheReadTokens = m.CacheReadTokens
	relayLog.CacheWriteTokens = m.CacheWriteTokens
	relayLog.WSMode = m.WSMode
	relayLog.WSExecMode = m.WSExecMode
	relayLog.WSRecovery = m.WSRecovery

	// 请求内容：优先原始请求体，保留 provider 专有字段（如 Anthropic cache_control）
	if len(m.RawRequest) > 0 {
		relayLog.RequestContent = string(m.RawRequest)
	} else if m.InternalRequest != nil {
		if reqJSON, jsonErr := json.Marshal(m.InternalRequest); jsonErr == nil {
			relayLog.RequestContent = string(reqJSON)
		}
	}

	// 响应内容
	if m.InternalResponse != nil {
		respForLog := m.filterResponseForLog(m.InternalResponse)
		if respJSON, jsonErr := json.Marshal(respForLog); jsonErr == nil {
			relayLog.ResponseContent = string(respJSON)
		}
	}

	// 错误信息
	if err != nil {
		relayLog.Error = err.Error()
	}
	relayLog.Success = success

	if logErr := op.RelayLogAdd(ctx, relayLog); logErr != nil {
		log.Warnf("failed to save relay log: %v", logErr)
	}
}

func updateFinalChannelUsageStats(channelID int, metrics model.StatsMetrics) {
	if channelID == 0 {
		return
	}
	usageStats := model.StatsMetrics{
		InputToken:               metrics.InputToken,
		OutputToken:              metrics.OutputToken,
		InputCost:                metrics.InputCost,
		OutputCost:               metrics.OutputCost,
		ProviderInputCost:        metrics.ProviderInputCost,
		ProviderOutputCost:       metrics.ProviderOutputCost,
		UnknownPriceRequests:     metrics.UnknownPriceRequests,
		UnknownPriceInputTokens:  metrics.UnknownPriceInputTokens,
		UnknownPriceOutputTokens: metrics.UnknownPriceOutputTokens,
		RouteFallbackRequests:    metrics.RouteFallbackRequests,
		ModelMismatchRequests:    metrics.ModelMismatchRequests,
	}
	if usageStats.InputToken == 0 && usageStats.OutputToken == 0 && usageStats.InputCost == 0 && usageStats.OutputCost == 0 &&
		usageStats.ProviderInputCost == 0 && usageStats.ProviderOutputCost == 0 && usageStats.UnknownPriceRequests == 0 {
		return
	}
	op.StatsChannelUpdate(channelID, usageStats)
}

func intPtr(value int) *int {
	return &value
}

func pointerInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func billingBasis(plan *model.BillingPlan) model.BillingBasis {
	if plan == nil {
		return model.BillingByActual
	}
	return plan.Basis
}

func wsModePtr(value model.RelayLogWSMode) *model.RelayLogWSMode {
	return &value
}

func wsExecModePtr(value model.RelayLogWSExecMode) *model.RelayLogWSExecMode {
	return &value
}

func wsRecoveryPtr(value model.RelayLogWSRecovery) *model.RelayLogWSRecovery {
	return &value
}

// filterResponseForLog 创建响应的浅拷贝，过滤掉 images、MultipleContent 中的图片数据和 Audio.Data 以减少存储压力
func (m *RelayMetrics) filterResponseForLog(resp *transformerModel.InternalLLMResponse) *transformerModel.InternalLLMResponse {
	if resp == nil {
		return nil
	}

	filterMsg := func(msg *transformerModel.Message) *transformerModel.Message {
		if msg == nil {
			return nil
		}
		c := *msg
		c.Images = nil
		if len(c.Content.MultipleContent) > 0 {
			parts := make([]transformerModel.MessageContentPart, 0, len(c.Content.MultipleContent))
			for _, p := range c.Content.MultipleContent {
				if p.Type == "image_url" && p.ImageURL != nil {
					parts = append(parts, transformerModel.MessageContentPart{
						Type:     "image_url",
						ImageURL: &transformerModel.ImageURL{URL: "[image data omitted for storage]"},
					})
				} else {
					parts = append(parts, p)
				}
			}
			c.Content = transformerModel.MessageContent{Content: c.Content.Content, MultipleContent: parts}
		}
		if c.Audio != nil && c.Audio.Data != "" {
			a := *c.Audio
			a.Data = "[audio data omitted for storage]"
			c.Audio = &a
		}
		return &c
	}

	filtered := *resp
	filtered.Choices = make([]transformerModel.Choice, len(resp.Choices))
	for i, choice := range resp.Choices {
		filtered.Choices[i] = choice
		filtered.Choices[i].Message = filterMsg(choice.Message)
		filtered.Choices[i].Delta = filterMsg(choice.Delta)
	}
	return &filtered
}
