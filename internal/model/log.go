package model

import "gorm.io/gorm"

const (
	RelayLogRequestSourceAPI         = "api"
	RelayLogRequestSourcePlayground  = "playground"
	RelayLogRequestSourceHealthCheck = "health_check"
)

// NormalizeRelayLogRequestSource keeps historical rows compatible without
// rewriting the potentially very large relay_logs table during startup.
func NormalizeRelayLogRequestSource(source string) string {
	if source == "" {
		return RelayLogRequestSourceAPI
	}
	return source
}

// AttemptStatus 尝试状态
type AttemptStatus string

const (
	AttemptSuccess      AttemptStatus = "success"       // 转发成功
	AttemptFailed       AttemptStatus = "failed"        // 转发失败
	AttemptCircuitBreak AttemptStatus = "circuit_break" // 熔断跳过
	AttemptSkipped      AttemptStatus = "skipped"       // 其他原因跳过（禁用、无Key、类型不兼容等）
)

// ChannelAttempt 记录单次渠道尝试的决策和结果
type ChannelAttempt struct {
	ChannelID    int           `json:"channel_id"`
	ChannelKeyID int           `json:"channel_key_id,omitempty"`
	ChannelName  string        `json:"channel_name"`
	ModelName    string        `json:"model_name"`
	AttemptNum   int           `json:"attempt_num"`
	Status       AttemptStatus `json:"status"`
	Duration     int           `json:"duration"`
	Sticky       bool          `json:"sticky,omitempty"`
	Msg          string        `json:"msg,omitempty"`
}

// RelayLogWSMode 表示本次上游 WebSocket 的会话/恢复模式。
type RelayLogWSMode string

const (
	RelayLogWSModeFresh        RelayLogWSMode = "fresh"        // 新建 WS 会话
	RelayLogWSModeContinuation RelayLogWSMode = "continuation" // 直接续传上游会话
	RelayLogWSModeReplay       RelayLogWSMode = "replay"       // 续传失败后回放上下文
)

// RelayLogWSExecMode 表示本次上游 WebSocket 的事件处理方式。
type RelayLogWSExecMode string

const (
	RelayLogWSExecModePassthrough RelayLogWSExecMode = "passthrough" // 原生 WS 事件直通
	RelayLogWSExecModeTransform   RelayLogWSExecMode = "transform"   // 经内部 transformer 管线转换
)

// RelayLogWSRecovery 表示本次会话在执行过程中触发的恢复动作。
type RelayLogWSRecovery string

const (
	RelayLogWSRecoveryReconnect RelayLogWSRecovery = "reconnect" // 续传链路失效后，原链路强制重连成功
	RelayLogWSRecoveryReplay    RelayLogWSRecovery = "replay"    // 续传失败后回放上下文成功
	RelayLogWSRecoveryDowngrade RelayLogWSRecovery = "downgrade" // WebSocket 不可用后降级到 HTTP
)

type RelayLog struct {
	ID                       int64               `json:"id" gorm:"primaryKey;autoIncrement:false"` // Snowflake ID
	Time                     int64               `json:"time"`                                     // 时间戳（秒）
	RequestModelName         string              `json:"request_model_name"`                       // 请求模型名称
	RequestSource            string              `json:"request_source" gorm:"size:32"`            // api/playground/health_check
	RequestID                string              `json:"request_id,omitempty" gorm:"size:96"`      // 后台执行请求关联 ID
	RoutedModelName          string              `json:"routed_model_name"`                        // 路由后发送给上游的模型名称
	RequestAPIKeyName        string              `json:"request_api_key_name"`                     // 请求使用的 API Key 名称
	ChannelId                int                 `json:"channel" gorm:"index"`                     // 实际使用的渠道ID
	ChannelName              string              `json:"channel_name"`                             // 渠道名称
	ActualModelName          string              `json:"actual_model_name"`                        // 实际使用模型名称
	RequestedCanonicalID     string              `json:"requested_canonical_id"`
	RoutedCanonicalID        string              `json:"routed_canonical_id"`
	ActualCanonicalID        string              `json:"actual_canonical_id"`
	BillingBasis             BillingBasis        `json:"billing_basis" gorm:"size:32"`
	BillingClassID           string              `json:"billing_class_id" gorm:"size:255"`
	BillingResolutionMethod  string              `json:"billing_resolution_method" gorm:"size:64"`
	BillingPriceSource       string              `json:"billing_price_source" gorm:"size:32"`
	BillingPriceVersion      string              `json:"billing_price_version" gorm:"size:128"`
	BillingPriceMode         PriceMode           `json:"billing_price_mode" gorm:"size:32"`
	BillingCostStatus        string              `json:"billing_cost_status" gorm:"size:32;index"`
	ProviderBillingClassID   string              `json:"provider_billing_class_id" gorm:"size:255"`
	ProviderResolutionMethod string              `json:"provider_resolution_method" gorm:"size:64"`
	ProviderPriceSource      string              `json:"provider_price_source" gorm:"size:32"`
	ProviderPriceVersion     string              `json:"provider_price_version" gorm:"size:128"`
	ProviderCostStatus       string              `json:"provider_cost_status" gorm:"size:32;index"`
	InputTokens              int                 `json:"input_tokens"`                     // 输入Token
	TransportInputTokens     *int                `json:"transport_input_tokens,omitempty"` // 实际发送到上游请求体的 Token 估算
	BillInputTokens          *int                `json:"bill_input_tokens,omitempty"`      // 按常规输入价格计费的 Token
	CacheReadTokens          *int                `json:"cache_read_tokens,omitempty"`      // 从缓存读取的 Token
	CacheWriteTokens         *int                `json:"cache_write_tokens,omitempty"`     // 写入缓存的 Token
	OutputTokens             int                 `json:"output_tokens"`                    // 输出 Token
	Ftut                     int                 `json:"ftut"`                             // 首字时间(毫秒)
	UseTime                  int                 `json:"use_time"`                         // 总用时(毫秒)
	Cost                     float64             `json:"cost"`                             // 消耗费用
	InputCost                float64             `json:"input_cost"`
	OutputCost               float64             `json:"output_cost"`
	ProviderInputCost        float64             `json:"provider_input_cost"`
	ProviderOutputCost       float64             `json:"provider_output_cost"`
	ProviderCost             float64             `json:"provider_cost"`
	UsageEstimated           bool                `json:"usage_estimated" gorm:"default:false"`
	PriceEstimated           bool                `json:"price_estimated" gorm:"default:false"`
	ModelMismatch            bool                `json:"model_mismatch" gorm:"default:false;index"`
	RequestContent           string              `json:"request_content"`                       // 请求内容
	ResponseContent          string              `json:"response_content"`                      // 响应内容
	Error                    string              `json:"error"`                                 // 错误信息
	Success                  bool                `json:"success" gorm:"not null;default:false"` // 是否成功，便于状态筛选索引
	Attempts                 []ChannelAttempt    `json:"attempts" gorm:"serializer:json"`       // 所有尝试记录
	TotalAttempts            int                 `json:"total_attempts"`                        // 总尝试次数
	UsedWS                   bool                `json:"used_ws" gorm:"default:false"`          // 是否使用了上游WebSocket
	WSMode                   *RelayLogWSMode     `json:"ws_mode,omitempty"`                     // 上游 WebSocket 会话模式
	WSExecMode               *RelayLogWSExecMode `json:"ws_exec_mode,omitempty"`                // 上游 WebSocket 事件处理方式
	WSRecovery               *RelayLogWSRecovery `json:"ws_recovery,omitempty"`                 // 本次请求触发的恢复动作
}

// AfterFind treats legacy NULL/empty request_source values as ordinary API
// traffic. This avoids an expensive one-shot UPDATE of all historical rows.
func (r *RelayLog) AfterFind(_ *gorm.DB) error {
	r.RequestSource = NormalizeRelayLogRequestSource(r.RequestSource)
	return nil
}
