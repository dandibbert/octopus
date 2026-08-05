package model

type StatsMetrics struct {
	InputToken               int64   `json:"input_token" gorm:"bigint"`
	OutputToken              int64   `json:"output_token" gorm:"bigint"`
	InputCost                float64 `json:"input_cost" gorm:"type:real"`
	OutputCost               float64 `json:"output_cost" gorm:"type:real"`
	ProviderInputCost        float64 `json:"provider_input_cost" gorm:"type:real"`
	ProviderOutputCost       float64 `json:"provider_output_cost" gorm:"type:real"`
	UnknownPriceRequests     int64   `json:"unknown_price_requests" gorm:"bigint"`
	UnknownPriceInputTokens  int64   `json:"unknown_price_input_tokens" gorm:"bigint"`
	UnknownPriceOutputTokens int64   `json:"unknown_price_output_tokens" gorm:"bigint"`
	RouteFallbackRequests    int64   `json:"route_fallback_requests" gorm:"bigint"`
	ModelMismatchRequests    int64   `json:"model_mismatch_requests" gorm:"bigint"`
	WaitTime                 int64   `json:"wait_time" gorm:"bigint"`
	RequestSuccess           int64   `json:"request_success" gorm:"bigint"`
	RequestFailed            int64   `json:"request_failed" gorm:"bigint"`
}

type StatsTotal struct {
	ID int `gorm:"primaryKey"`
	StatsMetrics
}

type StatsHourly struct {
	Hour int    `json:"hour" gorm:"primaryKey"`
	Date string `json:"date" gorm:"not null"` // 记录最后更新日期，格式：20060102
	StatsMetrics
}

type StatsDaily struct {
	Date string `json:"date" gorm:"primaryKey"`
	StatsMetrics
}

type StatsModel struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"not null"`
	ChannelID int    `json:"channel_id" gorm:"not null"`
	StatsMetrics
}

type StatsChannel struct {
	ChannelID int `json:"channel_id" gorm:"primaryKey"`
	StatsMetrics
}

type StatsAPIKey struct {
	APIKeyID int `json:"api_key_id" gorm:"primaryKey"`
	StatsMetrics
}

// StatsSiteModelHourly 站点渠道按小时聚合的请求统计，
// 用于站点渠道页折线图，覆盖任意时间跨度的可用性趋势。
type StatsSiteModelHourly struct {
	Hour          int    `json:"hour" gorm:"primaryKey;autoIncrement:false"`
	SiteAccountID int    `json:"site_account_id" gorm:"primaryKey;index:idx_stats_site_model_lookup"`
	GroupKey      string `json:"group_key" gorm:"primaryKey;type:varchar(128);index:idx_stats_site_model_lookup"`
	ModelName     string `json:"model_name" gorm:"primaryKey;type:varchar(128);index:idx_stats_site_model_lookup"`
	Date          string `json:"date" gorm:"not null;type:varchar(8)"`
	LastRequestAt int64  `json:"last_request_at" gorm:"not null;default:0"`
	StatsMetrics
}

// Add aggregates another StatsMetrics into the current one.
func (s *StatsMetrics) Add(delta StatsMetrics) {
	s.InputToken += delta.InputToken
	s.OutputToken += delta.OutputToken
	s.InputCost += delta.InputCost
	s.OutputCost += delta.OutputCost
	s.ProviderInputCost += delta.ProviderInputCost
	s.ProviderOutputCost += delta.ProviderOutputCost
	s.UnknownPriceRequests += delta.UnknownPriceRequests
	s.UnknownPriceInputTokens += delta.UnknownPriceInputTokens
	s.UnknownPriceOutputTokens += delta.UnknownPriceOutputTokens
	s.RouteFallbackRequests += delta.RouteFallbackRequests
	s.ModelMismatchRequests += delta.ModelMismatchRequests
	s.WaitTime += delta.WaitTime
	s.RequestSuccess += delta.RequestSuccess
	s.RequestFailed += delta.RequestFailed
}
