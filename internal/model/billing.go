package model

import (
	"strconv"
	"strings"
	"time"
)

type BillingBasis string

const (
	BillingByActual    BillingBasis = "actual"
	BillingByRequested BillingBasis = "requested"
	BillingByRouted    BillingBasis = "routed"
	BillingByFixedSKU  BillingBasis = "fixed_sku"
)

func (b BillingBasis) Valid() bool {
	switch b {
	case BillingByActual, BillingByRequested, BillingByRouted, BillingByFixedSKU:
		return true
	default:
		return false
	}
}

func (b BillingBasis) Normalize() BillingBasis {
	if b.Valid() {
		return b
	}
	return BillingByActual
}

type PriceMode string

const (
	PriceUnknown   PriceMode = "unknown"
	PriceExplicit  PriceMode = "explicit"
	PriceFree      PriceMode = "free"
	PriceInherited PriceMode = "inherited"
)

func (m PriceMode) Valid() bool {
	switch m {
	case PriceUnknown, PriceExplicit, PriceFree, PriceInherited:
		return true
	default:
		return false
	}
}

type UnknownPricePolicy string

const (
	UnknownReject      UnknownPricePolicy = "reject"
	UnknownMarkUnknown UnknownPricePolicy = "mark_unknown"
	UnknownUseRouted   UnknownPricePolicy = "use_routed"
	UnknownUseActual   UnknownPricePolicy = "use_actual"
)

func (p UnknownPricePolicy) Valid() bool {
	switch p {
	case UnknownReject, UnknownMarkUnknown, UnknownUseRouted, UnknownUseActual:
		return true
	default:
		return false
	}
}

func (p UnknownPricePolicy) Normalize(fallback UnknownPricePolicy) UnknownPricePolicy {
	if p.Valid() {
		return p
	}
	return fallback
}

const (
	BillingStatusResolved = "resolved"
	BillingStatusFree     = "free"
	BillingStatusUnknown  = "unknown"
	BillingStatusConflict = "conflict"
)

type ModelResolveContext struct {
	RawModel               string
	Provider               string
	ChannelID              int
	AllowedWrapperPrefixes []string
	Purpose                string
	RouteCanonicalHint     string
	RouteBillingHint       string
}

type ModelResolution struct {
	RawModel         string `json:"raw_model"`
	NormalizedModel  string `json:"normalized_model"`
	Provider         string `json:"provider"`
	CanonicalModelID string `json:"canonical_model_id"`
	BillingClassID   string `json:"billing_class_id"`
	Method           string `json:"method"`
	Confidence       int    `json:"confidence"`
	Estimated        bool   `json:"estimated"`
	AliasID          *int64 `json:"alias_id,omitempty"`
	Status           string `json:"status"`
}

type PriceResolution struct {
	Price          *LLMPrice `json:"price,omitempty"`
	BillingClassID string    `json:"billing_class_id"`
	PriceSource    string    `json:"price_source"`
	PriceVersion   string    `json:"price_version"`
	PriceMode      PriceMode `json:"price_mode"`
	Status         string    `json:"status"`
	Method         string    `json:"method"`
	Estimated      bool      `json:"estimated"`
}

type BillingPolicy struct {
	Basis                 BillingBasis
	BillingClassID        string
	UnknownPolicy         UnknownPricePolicy
	ProviderUnknownPolicy UnknownPricePolicy
	RequireKnown          bool
}

type BillingPlan struct {
	PolicyID     string
	Basis        BillingBasis
	RequireKnown bool

	Provider  string
	ChannelID int

	RequestedModel       string
	RequestedCanonicalID string
	RoutedModel          string
	RoutedCanonicalID    string

	BillingClassID      string
	Price               *LLMPrice
	PriceSource         string
	PriceVersion        string
	PriceMode           PriceMode
	ResolutionMethod    string
	UnknownPolicy       UnknownPricePolicy
	ProviderUnknownRule UnknownPricePolicy

	RequestedResolution ModelResolution
	RoutedResolution    ModelResolution
	RoutedPrice         PriceResolution
}

type CostBreakdown struct {
	Input  float64 `json:"input"`
	Output float64 `json:"output"`
	Total  float64 `json:"total"`
	Status string  `json:"status"`
}

type ModelAlias struct {
	ID               int64     `json:"id" gorm:"primaryKey"`
	ScopeKey         string    `json:"scope_key" gorm:"size:191;not null;index:idx_model_alias_scope_alias,unique"`
	ChannelID        *int      `json:"channel_id,omitempty" gorm:"index"`
	Provider         string    `json:"provider,omitempty" gorm:"size:64;index"`
	Alias            string    `json:"alias" gorm:"size:255;not null;index:idx_model_alias_scope_alias,unique"`
	CanonicalModelID string    `json:"canonical_model_id" gorm:"size:255;not null;index"`
	BillingClassID   string    `json:"billing_class_id,omitempty" gorm:"size:255;index"`
	Source           string    `json:"source" gorm:"size:32;not null;default:'user'"`
	Priority         int       `json:"priority" gorm:"not null;default:0"`
	Enabled          bool      `json:"enabled" gorm:"not null;default:true"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func NormalizeModelIdentityValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func ModelAliasScopeKey(channelID *int, provider string) string {
	if channelID != nil && *channelID > 0 {
		return "channel:" + strconv.Itoa(*channelID)
	}
	provider = NormalizeModelIdentityValue(provider)
	if provider != "" {
		return "provider:" + provider
	}
	return "global"
}
