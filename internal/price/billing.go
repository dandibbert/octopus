package price

import (
	"errors"
	"fmt"
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
)

var ErrUnknownBillingPrice = errors.New("billing price is unknown")

type UnknownBillingPriceError struct {
	Basis          model.BillingBasis
	BillingClassID string
	Model          string
}

func (e *UnknownBillingPriceError) Error() string {
	return fmt.Sprintf("%v: basis=%s billing_class=%q model=%q", ErrUnknownBillingPrice, e.Basis, e.BillingClassID, e.Model)
}

func (e *UnknownBillingPriceError) Unwrap() error {
	return ErrUnknownBillingPrice
}

func ResolvePrice(resolution model.ModelResolution) model.PriceResolution {
	for _, key := range priceLookupKeys(resolution) {
		if info, err := op.LLMGetInfo(key); err == nil {
			if resolved, ok := userPriceResolution(info, resolution.Method); ok {
				return resolved
			}
		}
	}
	if resolution.BillingClassID != "" {
		if info, err := op.LLMGetByBillingClassID(resolution.BillingClassID); err == nil {
			if resolved, ok := userPriceResolution(info, resolution.Method); ok {
				return resolved
			}
		}
	}
	if entry, ok := catalogEntryByBillingClass(resolution.BillingClassID); ok {
		return catalogPriceResolution(entry, resolution.Method)
	}
	if entry, ok := catalogEntryByCanonical(resolution.CanonicalModelID); ok {
		return catalogPriceResolution(entry, resolution.Method)
	}
	return unknownPriceResolution(resolution.BillingClassID, resolution.Method)
}

func ResolvePriceByBillingClassID(billingClassID string) model.PriceResolution {
	billingClassID = model.NormalizeModelIdentityValue(billingClassID)
	if billingClassID == "" {
		return unknownPriceResolution("", "unknown")
	}
	if info, err := op.LLMGetByBillingClassID(billingClassID); err == nil {
		if resolved, ok := userPriceResolution(info, "route_binding"); ok {
			return resolved
		}
	}
	if info, err := op.LLMGetInfo(billingClassID); err == nil {
		if resolved, ok := userPriceResolution(info, "route_binding"); ok {
			return resolved
		}
	}
	if entry, ok := catalogEntryByBillingClass(billingClassID); ok {
		return catalogPriceResolution(entry, "route_binding")
	}
	return unknownPriceResolution(billingClassID, "route_binding")
}

func BuildBillingPlan(requestedModel string, channel model.Channel, item model.GroupItem, requireKnown bool) (model.BillingPlan, error) {
	provider := ChannelProvider(channel)
	basis := item.BillingBasis
	if !basis.Valid() {
		basis = channel.BillingBasis.Normalize()
	}
	billingClassID := model.NormalizeModelIdentityValue(item.BillingClassID)
	if billingClassID == "" {
		billingClassID = model.NormalizeModelIdentityValue(channel.BillingClass)
	}
	unknownPolicy := item.BillingUnknownPolicy
	if !unknownPolicy.Valid() {
		unknownPolicy = channel.BillingUnknownPolicy.Normalize(model.UnknownUseRouted)
	}
	providerUnknownPolicy := channel.ProviderUnknownPolicy.Normalize(model.UnknownUseRouted)

	requestedResolution := ResolveModelIdentity(model.ModelResolveContext{
		RawModel:  requestedModel,
		Provider:  provider,
		ChannelID: channel.ID,
		Purpose:   "requested",
	})
	routedResolution := ResolveModelIdentity(model.ModelResolveContext{
		RawModel:               item.ModelName,
		Provider:               provider,
		ChannelID:              channel.ID,
		AllowedWrapperPrefixes: channel.ModelWrappers,
		Purpose:                "routed",
	})
	routedPrice := ResolvePrice(routedResolution)
	plan := model.BillingPlan{
		PolicyID:             fmt.Sprintf("channel:%d/group_item:%d", channel.ID, item.ID),
		Basis:                basis,
		RequireKnown:         requireKnown,
		Provider:             provider,
		ChannelID:            channel.ID,
		RequestedModel:       requestedModel,
		RequestedCanonicalID: requestedResolution.CanonicalModelID,
		RoutedModel:          item.ModelName,
		RoutedCanonicalID:    routedResolution.CanonicalModelID,
		UnknownPolicy:        unknownPolicy,
		ProviderUnknownRule:  providerUnknownPolicy,
		RequestedResolution:  requestedResolution,
		RoutedResolution:     routedResolution,
		RoutedPrice:          routedPrice,
	}

	switch basis {
	case model.BillingByRequested:
		plan.BillingClassID = billingClassID
		plan.ResolutionMethod = "route_binding"
		applyFrozenPrice(&plan, ResolvePriceByBillingClassID(billingClassID))
	case model.BillingByRouted:
		plan.BillingClassID = routedResolution.BillingClassID
		plan.ResolutionMethod = routedResolution.Method
		applyFrozenPrice(&plan, routedPrice)
	case model.BillingByFixedSKU:
		plan.BillingClassID = billingClassID
		plan.ResolutionMethod = "fixed_sku"
		applyFrozenPrice(&plan, ResolvePriceByBillingClassID(billingClassID))
	default:
		plan.Basis = model.BillingByActual
		plan.BillingClassID = routedResolution.BillingClassID
		plan.ResolutionMethod = "actual_pending"
	}

	if plan.Basis == model.BillingByRequested || plan.Basis == model.BillingByFixedSKU {
		if billingClassID == "" {
			return plan, &UnknownBillingPriceError{Basis: plan.Basis, Model: requestedModel}
		}
	}
	preflightPrice := frozenPlanPrice(plan)
	if plan.Basis == model.BillingByActual {
		preflightPrice = routedPrice
	}
	if preflightPrice.Status == model.BillingStatusUnknown && (requireKnown || unknownPolicy == model.UnknownReject) {
		return plan, &UnknownBillingPriceError{Basis: plan.Basis, BillingClassID: plan.BillingClassID, Model: requestedModel}
	}
	return plan, nil
}

func ResolveFinalBilling(plan model.BillingPlan, actualModel string) (model.ModelResolution, model.PriceResolution, model.PriceResolution, bool) {
	actualResolution := ResolveModelIdentity(model.ModelResolveContext{
		RawModel:           actualModel,
		Provider:           plan.Provider,
		ChannelID:          plan.ChannelID,
		Purpose:            "actual",
		RouteCanonicalHint: plan.RoutedResolution.CanonicalModelID,
		RouteBillingHint:   plan.RoutedResolution.BillingClassID,
	})
	providerPrice := ResolvePrice(actualResolution)
	if providerPrice.Status == model.BillingStatusUnknown && plan.ProviderUnknownRule == model.UnknownUseRouted {
		providerPrice = routeFallbackPrice(plan.RoutedPrice)
	} else if actualResolution.Estimated && providerPrice.Status != model.BillingStatusUnknown {
		providerPrice.Method = "route_fallback"
		providerPrice.Estimated = true
	}

	var billedPrice model.PriceResolution
	switch plan.Basis {
	case model.BillingByRequested, model.BillingByRouted, model.BillingByFixedSKU:
		billedPrice = frozenPlanPrice(plan)
		if billedPrice.Status == model.BillingStatusUnknown {
			switch plan.UnknownPolicy {
			case model.UnknownUseRouted:
				billedPrice = routeFallbackPrice(plan.RoutedPrice)
			case model.UnknownUseActual:
				billedPrice = ResolvePrice(actualResolution)
				if billedPrice.Status != model.BillingStatusUnknown {
					billedPrice.Method = "actual_override"
				}
			}
		}
	default:
		billedPrice = ResolvePrice(actualResolution)
		if billedPrice.Status == model.BillingStatusUnknown && plan.UnknownPolicy == model.UnknownUseRouted {
			billedPrice = routeFallbackPrice(plan.RoutedPrice)
		} else if actualResolution.Estimated && billedPrice.Status != model.BillingStatusUnknown {
			billedPrice.Method = "route_fallback"
			billedPrice.Estimated = true
		}
	}
	mismatch := actualResolution.CanonicalModelID != "" && plan.RoutedResolution.CanonicalModelID != "" &&
		actualResolution.CanonicalModelID != plan.RoutedResolution.CanonicalModelID
	return actualResolution, providerPrice, billedPrice, mismatch
}

func CalculateCost(nonCachedInput, cacheRead, cacheWrite, output int64, priceResolution model.PriceResolution) model.CostBreakdown {
	if priceResolution.Status == model.BillingStatusUnknown || priceResolution.Price == nil {
		return model.CostBreakdown{Status: model.BillingStatusUnknown}
	}
	if priceResolution.PriceMode == model.PriceFree {
		return model.CostBreakdown{Status: model.BillingStatusFree}
	}
	price := priceResolution.Price
	inputCost := (float64(maxInt64(nonCachedInput, 0))*price.Input +
		float64(maxInt64(cacheRead, 0))*price.CacheRead +
		float64(maxInt64(cacheWrite, 0))*price.CacheWrite) * 1e-6
	outputCost := float64(maxInt64(output, 0)) * price.Output * 1e-6
	return model.CostBreakdown{
		Input:  inputCost,
		Output: outputCost,
		Total:  inputCost + outputCost,
		Status: model.BillingStatusResolved,
	}
}

func ChannelProvider(channel model.Channel) string {
	if provider := model.NormalizeModelIdentityValue(channel.Provider); provider != "" {
		return provider
	}
	switch channel.Type {
	case outbound.OutboundTypeAnthropic:
		return "anthropic"
	case outbound.OutboundTypeGemini:
		return "google"
	case outbound.OutboundTypeVolcengine:
		return "volcengine"
	default:
		return ""
	}
}

func priceLookupKeys(resolution model.ModelResolution) []string {
	seen := make(map[string]struct{})
	keys := make([]string, 0, 4)
	for _, key := range []string{resolution.NormalizedModel, resolution.BillingClassID, resolution.CanonicalModelID, canonicalBareModel(resolution.CanonicalModelID)} {
		key = model.NormalizeModelIdentityValue(key)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys
}

func userPriceResolution(info model.LLMInfo, method string) (model.PriceResolution, bool) {
	if info.PriceMode != model.PriceExplicit && info.PriceMode != model.PriceFree {
		return model.PriceResolution{}, false
	}
	price := info.LLMPrice
	status := model.BillingStatusResolved
	if info.PriceMode == model.PriceFree {
		price = model.LLMPrice{}
		status = model.BillingStatusFree
	}
	return model.PriceResolution{
		Price:          &price,
		BillingClassID: firstNonEmpty(info.BillingClassID, info.CanonicalModelID, info.Name),
		PriceSource:    "user",
		PriceVersion:   firstNonEmpty(info.PriceVersion, info.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")),
		PriceMode:      info.PriceMode,
		Status:         status,
		Method:         method,
	}, true
}

func catalogPriceResolution(entry catalogEntry, method string) model.PriceResolution {
	price := entry.Price
	return model.PriceResolution{
		Price:          &price,
		BillingClassID: entry.BillingClassID,
		PriceSource:    entry.Source,
		PriceVersion:   entry.Version,
		PriceMode:      model.PriceExplicit,
		Status:         model.BillingStatusResolved,
		Method:         method,
	}
}

func unknownPriceResolution(billingClassID, method string) model.PriceResolution {
	return model.PriceResolution{
		BillingClassID: billingClassID,
		PriceMode:      model.PriceUnknown,
		Status:         model.BillingStatusUnknown,
		Method:         method,
	}
}

func routeFallbackPrice(priceResolution model.PriceResolution) model.PriceResolution {
	priceResolution.Method = "route_fallback"
	priceResolution.Estimated = true
	return priceResolution
}

func applyFrozenPrice(plan *model.BillingPlan, priceResolution model.PriceResolution) {
	plan.Price = priceResolution.Price
	plan.PriceSource = priceResolution.PriceSource
	plan.PriceVersion = priceResolution.PriceVersion
	plan.PriceMode = priceResolution.PriceMode
	if plan.BillingClassID == "" {
		plan.BillingClassID = priceResolution.BillingClassID
	}
}

func frozenPlanPrice(plan model.BillingPlan) model.PriceResolution {
	status := model.BillingStatusResolved
	if plan.Price == nil || plan.PriceMode == model.PriceUnknown {
		status = model.BillingStatusUnknown
	} else if plan.PriceMode == model.PriceFree {
		status = model.BillingStatusFree
	}
	return model.PriceResolution{
		Price:          plan.Price,
		BillingClassID: plan.BillingClassID,
		PriceSource:    plan.PriceSource,
		PriceVersion:   plan.PriceVersion,
		PriceMode:      plan.PriceMode,
		Status:         status,
		Method:         plan.ResolutionMethod,
	}
}

func canonicalBareModel(canonicalID string) string {
	canonicalID = model.NormalizeModelIdentityValue(canonicalID)
	_, value, ok := strings.Cut(canonicalID, ":")
	if !ok {
		return canonicalID
	}
	return strings.TrimSuffix(value, "/default")
}

func maxInt64(value, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
