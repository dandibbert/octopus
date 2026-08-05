package helper

import (
	"context"
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/price"
)

func LLMPriceAddToDB(modelNames []string, ctx context.Context) error {
	return LLMPriceAddToDBForChannel(modelNames, nil, ctx)
}

func LLMPriceAddToDBForChannel(modelNames []string, channel *model.Channel, ctx context.Context) error {
	provider := ""
	channelID := 0
	var wrappers []string
	if channel != nil {
		provider = price.ChannelProvider(*channel)
		channelID = channel.ID
		wrappers = channel.ModelWrappers
	}

	for _, rawName := range modelNames {
		name := model.NormalizeModelIdentityValue(rawName)
		if name == "" {
			continue
		}
		resolution := price.ResolveModelIdentity(model.ModelResolveContext{
			RawModel:               name,
			Provider:               provider,
			ChannelID:              channelID,
			AllowedWrapperPrefixes: wrappers,
			Purpose:                "discovery",
		})
		info := model.LLMInfo{
			Name:             name,
			Provider:         resolution.Provider,
			CanonicalModelID: resolution.CanonicalModelID,
			BillingClassID:   resolution.BillingClassID,
			PriceMode:        model.PriceUnknown,
			PriceSource:      "auto",
			AutoDiscovered:   true,
			NeedsReview:      true,
		}
		priceResolution := price.ResolvePrice(resolution)
		if resolution.Status == model.BillingStatusResolved && priceResolution.Status != model.BillingStatusUnknown {
			info.PriceMode = model.PriceInherited
			info.PriceSource = priceResolution.PriceSource
			info.PriceVersion = priceResolution.PriceVersion
			info.NeedsReview = false
			if priceResolution.Price != nil {
				info.LLMPrice = *priceResolution.Price
			}
		}
		if err := op.LLMUpsertDiscovered(info, ctx); err != nil {
			return err
		}
		if err := ensureDiscoveredModelAlias(name, resolution, channel, ctx); err != nil {
			return err
		}
	}
	return nil
}

// ReconcileAutoDiscoveredModelIdentities refreshes only rows that are already
// known to be system-discovered. Ambiguous legacy/user-created zero rows remain
// unknown and require administrator review.
func ReconcileAutoDiscoveredModelIdentities(ctx context.Context) error {
	infos, err := op.LLMList(ctx)
	if err != nil {
		return err
	}
	for _, info := range infos {
		if !info.AutoDiscovered || (info.PriceMode != model.PriceUnknown && info.PriceMode != model.PriceInherited) {
			continue
		}
		resolution := price.ResolveModelIdentity(model.ModelResolveContext{
			RawModel:           info.Name,
			Provider:           info.Provider,
			Purpose:            "reconcile",
			RouteCanonicalHint: stableCanonicalHint(info),
			RouteBillingHint:   stableBillingHint(info),
		})
		info.CanonicalModelID = resolution.CanonicalModelID
		info.BillingClassID = resolution.BillingClassID
		info.Provider = resolution.Provider
		info.PriceMode = model.PriceUnknown
		info.PriceSource = "auto"
		info.PriceVersion = ""
		info.NeedsReview = true
		info.LLMPrice = model.LLMPrice{}
		priceResolution := price.ResolvePrice(resolution)
		if resolution.Status == model.BillingStatusResolved && priceResolution.Status != model.BillingStatusUnknown {
			info.PriceMode = model.PriceInherited
			info.PriceSource = priceResolution.PriceSource
			info.PriceVersion = priceResolution.PriceVersion
			info.NeedsReview = false
			if priceResolution.Price != nil {
				info.LLMPrice = *priceResolution.Price
			}
		}
		if err := op.LLMUpsertDiscovered(info, ctx); err != nil {
			return err
		}
	}
	return nil
}

func ensureDiscoveredModelAlias(rawName string, resolution model.ModelResolution, channel *model.Channel, ctx context.Context) error {
	if resolution.Status != model.BillingStatusResolved || resolution.CanonicalModelID == "" {
		return nil
	}
	alias := model.ModelAlias{
		Alias:            rawName,
		CanonicalModelID: resolution.CanonicalModelID,
		BillingClassID:   resolution.BillingClassID,
		Source:           "auto",
		Enabled:          true,
	}
	switch resolution.Method {
	case "channel_wrapper":
		if channel == nil || channel.ID <= 0 {
			return nil
		}
		channelID := channel.ID
		alias.ChannelID = &channelID
	case "provider_prefix", "snapshot":
		if resolution.Provider == "" {
			return nil
		}
		alias.Provider = resolution.Provider
	default:
		return nil
	}
	return op.ModelAliasUpsertAuto(&alias, ctx)
}

func stableCanonicalHint(info model.LLMInfo) string {
	canonical := model.NormalizeModelIdentityValue(info.CanonicalModelID)
	if canonical == "" || canonical == model.NormalizeModelIdentityValue(info.Name) {
		return ""
	}
	return canonical
}

func stableBillingHint(info model.LLMInfo) string {
	billingClassID := model.NormalizeModelIdentityValue(info.BillingClassID)
	if billingClassID == "" || billingClassID == model.NormalizeModelIdentityValue(info.Name) {
		return ""
	}
	return billingClassID
}

func LLMPriceDeleteFromDBWithNoPrice(modelNames []string, ctx context.Context) error {
	if len(modelNames) == 0 {
		return nil
	}
	needDeleteModelNames := make([]string, 0, len(modelNames))
	for _, rawName := range modelNames {
		name := model.NormalizeModelIdentityValue(rawName)
		if name == "" {
			continue
		}
		info, err := op.LLMGetInfo(name)
		if err != nil {
			continue
		}
		if !info.AutoDiscovered {
			continue
		}
		if info.PriceMode != model.PriceUnknown && info.PriceMode != model.PriceInherited {
			continue
		}
		if strings.EqualFold(info.PriceSource, "user") {
			continue
		}
		needDeleteModelNames = append(needDeleteModelNames, name)
	}
	if len(needDeleteModelNames) > 0 {
		return op.LLMBatchDelete(needDeleteModelNames, ctx)
	}
	return nil
}
