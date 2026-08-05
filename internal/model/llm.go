package model

import "time"

type LLMPrice struct {
	Input      float64 `json:"input"`
	Output     float64 `json:"output"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
}

type LLMInfo struct {
	Name                  string    `json:"name" gorm:"primaryKey;not null"`
	Provider              string    `json:"provider,omitempty" gorm:"size:64;index"`
	CanonicalModelID      string    `json:"canonical_model_id,omitempty" gorm:"size:255;index"`
	BillingClassID        string    `json:"billing_class_id,omitempty" gorm:"size:255;index"`
	PriceMode             PriceMode `json:"price_mode" gorm:"size:32;not null;default:'unknown';index"`
	PriceSource           string    `json:"price_source,omitempty" gorm:"size:32;not null;default:'user'"`
	PriceVersion          string    `json:"price_version,omitempty" gorm:"size:128"`
	AutoDiscovered        bool      `json:"auto_discovered" gorm:"not null;default:false;index"`
	NeedsReview           bool      `json:"needs_review" gorm:"not null;default:false;index"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
	EffectivePrice        *LLMPrice `json:"effective_price,omitempty" gorm:"-"`
	EffectivePriceSource  string    `json:"effective_price_source,omitempty" gorm:"-"`
	EffectivePriceVersion string    `json:"effective_price_version,omitempty" gorm:"-"`
	ResolutionStatus      string    `json:"resolution_status,omitempty" gorm:"-"`
	ResolutionMethod      string    `json:"resolution_method,omitempty" gorm:"-"`
	ModelType             string    `json:"model_type,omitempty" gorm:"-"`
	InheritedFrom         string    `json:"inherited_from,omitempty" gorm:"-"`
	CatalogOnly           bool      `json:"catalog_only,omitempty" gorm:"-"`
	LLMPrice
}

type LLMChannel struct {
	Name            string `json:"name"`
	Enabled         bool   `json:"enabled"`
	ChannelID       int    `json:"channel_id"`
	ChannelName     string `json:"channel_name"`
	SiteID          *int   `json:"site_id,omitempty"`
	SiteAccountID   *int   `json:"site_account_id,omitempty"`
	SiteGroupKey    string `json:"site_group_key,omitempty"`
	SiteGroupName   string `json:"site_group_name,omitempty"`
	SiteName        string `json:"site_name,omitempty"`
	SiteAccountName string `json:"site_account_name,omitempty"`
	EndpointType    string `json:"endpoint_type,omitempty"`
}

type GeminiModel struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
}

type GeminiModelList struct {
	Models        []GeminiModel `json:"models"`
	NextPageToken string        `json:"nextPageToken"`
}

type OpenAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int    `json:"created"`
	OwnedBy string `json:"owned_by"`
}

type OpenAIModelList struct {
	Object string        `json:"object"`
	Data   []OpenAIModel `json:"data"`
}
type AnthropicModel struct {
	ID          string `json:"id"`
	CreatedAt   string `json:"created_at"`
	DisplayName string `json:"display_name"`
	Type        string `json:"type"`
}

type AnthropicModelList struct {
	Data    []AnthropicModel `json:"data"`
	FirstID string           `json:"first_id"`
	HasMore bool             `json:"has_more"`
	LastID  string           `json:"last_id"`
}
