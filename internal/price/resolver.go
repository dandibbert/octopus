package price

import (
	"regexp"
	"sort"
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
)

var snapshotSuffixPattern = regexp.MustCompile(`^(?:-\d{4}-\d{2}-\d{2}|-\d{8})$`)

func ResolveModelIdentity(ctx model.ModelResolveContext) model.ModelResolution {
	raw := strings.TrimSpace(ctx.RawModel)
	normalized := model.NormalizeModelIdentityValue(raw)
	provider := model.NormalizeModelIdentityValue(ctx.Provider)
	unknown := model.ModelResolution{
		RawModel:        raw,
		NormalizedModel: normalized,
		Provider:        provider,
		Method:          "unknown",
		Status:          model.BillingStatusUnknown,
	}
	if normalized == "" {
		return unknown
	}

	if alias, method, ok := op.ModelAliasResolve(ctx.ChannelID, provider, normalized); ok {
		billingClassID := alias.BillingClassID
		if billingClassID == "" {
			billingClassID = canonicalBillingClassID(alias.CanonicalModelID)
		}
		aliasID := alias.ID
		return model.ModelResolution{
			RawModel:         raw,
			NormalizedModel:  normalized,
			Provider:         providerFromCanonical(alias.CanonicalModelID, provider),
			CanonicalModelID: alias.CanonicalModelID,
			BillingClassID:   billingClassID,
			Method:           method,
			Confidence:       100,
			AliasID:          &aliasID,
			Status:           model.BillingStatusResolved,
		}
	}
	return resolveModelIdentityWithoutAlias(ctx)
}

// resolveModelIdentityWithoutAlias 仅用于判断模型自身是否已有价格身份，
// 避免旧 Alias 掩盖源模型本身的目录价格。
func resolveModelIdentityWithoutAlias(ctx model.ModelResolveContext) model.ModelResolution {
	raw := strings.TrimSpace(ctx.RawModel)
	normalized := model.NormalizeModelIdentityValue(raw)
	provider := model.NormalizeModelIdentityValue(ctx.Provider)
	unknown := model.ModelResolution{
		RawModel:        raw,
		NormalizedModel: normalized,
		Provider:        provider,
		Method:          "unknown",
		Status:          model.BillingStatusUnknown,
	}
	if normalized == "" {
		return unknown
	}

	if resolution, ok := resolveUserCatalogExact(raw, normalized, provider); ok {
		return resolution
	}
	if resolution, status := resolveCatalogExact(raw, normalized, provider); status != "" {
		return resolution
	}
	if resolution, ok := resolveProviderPrefix(raw, normalized, provider); ok {
		return resolution
	}
	if resolution, ok := resolveChannelWrapper(ctx, raw, normalized, provider); ok {
		return resolution
	}
	if resolution, ok := resolveSnapshot(raw, normalized, provider); ok {
		return resolution
	}
	if hint := model.NormalizeModelIdentityValue(ctx.RouteCanonicalHint); hint != "" {
		billingHint := model.NormalizeModelIdentityValue(ctx.RouteBillingHint)
		if billingHint == "" {
			billingHint = canonicalBillingClassID(hint)
		}
		return model.ModelResolution{
			RawModel:         raw,
			NormalizedModel:  normalized,
			Provider:         providerFromCanonical(hint, provider),
			CanonicalModelID: hint,
			BillingClassID:   billingHint,
			Method:           "route_binding",
			Confidence:       80,
			Estimated:        true,
			Status:           model.BillingStatusResolved,
		}
	}
	return unknown
}

func resolveUserCatalogExact(raw, normalized, provider string) (model.ModelResolution, bool) {
	info, err := op.LLMGetInfo(normalized)
	if err != nil {
		return model.ModelResolution{}, false
	}
	if info.PriceMode == model.PriceUnknown && model.NormalizeModelIdentityValue(info.CanonicalModelID) == normalized {
		return model.ModelResolution{}, false
	}
	canonicalID := model.NormalizeModelIdentityValue(info.CanonicalModelID)
	if canonicalID == "" {
		canonicalID = canonicalModelID(info.Provider, normalized)
	}
	billingClassID := model.NormalizeModelIdentityValue(info.BillingClassID)
	if billingClassID == "" {
		billingClassID = canonicalBillingClassID(canonicalID)
	}
	return model.ModelResolution{
		RawModel:         raw,
		NormalizedModel:  normalized,
		Provider:         providerFromCanonical(canonicalID, firstNonEmpty(info.Provider, provider)),
		CanonicalModelID: canonicalID,
		BillingClassID:   billingClassID,
		Method:           "exact",
		Confidence:       100,
		Status:           model.BillingStatusResolved,
	}, true
}

func resolveCatalogExact(raw, normalized, provider string) (model.ModelResolution, string) {
	if entry, ok := catalogEntryByCanonical(normalized); ok {
		return catalogResolution(raw, normalized, entry, "exact", 100, false), model.BillingStatusResolved
	}
	candidates := catalogCandidates(normalized, provider)
	if len(candidates) == 1 {
		return catalogResolution(raw, normalized, candidates[0], "exact", 100, false), model.BillingStatusResolved
	}
	if len(candidates) > 1 {
		return model.ModelResolution{
			RawModel:        raw,
			NormalizedModel: normalized,
			Provider:        provider,
			Method:          "conflict",
			Status:          model.BillingStatusConflict,
		}, model.BillingStatusConflict
	}
	return model.ModelResolution{}, ""
}

func resolveProviderPrefix(raw, normalized, currentProvider string) (model.ModelResolution, bool) {
	namespace, modelID, ok := strings.Cut(normalized, "/")
	if !ok || !knownProvider(namespace) {
		return model.ModelResolution{}, false
	}
	if currentProvider != "" && currentProvider != namespace {
		return model.ModelResolution{}, false
	}
	candidates := catalogCandidates(modelID, namespace)
	if len(candidates) != 1 {
		return model.ModelResolution{}, false
	}
	return catalogResolution(raw, normalized, candidates[0], "provider_prefix", 95, false), true
}

func resolveChannelWrapper(ctx model.ModelResolveContext, raw, normalized, provider string) (model.ModelResolution, bool) {
	prefixes := append([]string(nil), ctx.AllowedWrapperPrefixes...)
	if provider == "anthropic" && ctx.ChannelID > 0 {
		prefixes = append(prefixes, "~")
	}
	seen := make(map[string]struct{})
	for _, prefix := range prefixes {
		prefix = strings.TrimSpace(prefix)
		if prefix == "" {
			continue
		}
		if _, ok := seen[prefix]; ok {
			continue
		}
		seen[prefix] = struct{}{}
		if !strings.HasPrefix(normalized, prefix) {
			continue
		}
		stripped := strings.TrimPrefix(normalized, prefix)
		resolution, ok := resolveProviderPrefix(raw, stripped, provider)
		if !ok {
			continue
		}
		resolution.NormalizedModel = normalized
		resolution.Method = "channel_wrapper"
		resolution.Confidence = 90
		return resolution, true
	}
	return model.ModelResolution{}, false
}

func resolveSnapshot(raw, normalized, provider string) (model.ModelResolution, bool) {
	entries := catalogProviderModels(provider)
	for _, entry := range entries {
		if !strings.HasPrefix(normalized, entry.ModelID) {
			continue
		}
		suffix := strings.TrimPrefix(normalized, entry.ModelID)
		if !snapshotSuffixPattern.MatchString(suffix) {
			continue
		}
		return catalogResolution(raw, normalized, entry, "snapshot", 90, false), true
	}
	return model.ModelResolution{}, false
}

func catalogResolution(raw, normalized string, entry catalogEntry, method string, confidence int, estimated bool) model.ModelResolution {
	return model.ModelResolution{
		RawModel:         raw,
		NormalizedModel:  normalized,
		Provider:         entry.Provider,
		CanonicalModelID: entry.CanonicalModelID,
		BillingClassID:   entry.BillingClassID,
		Method:           method,
		Confidence:       confidence,
		Estimated:        estimated,
		Status:           model.BillingStatusResolved,
	}
}

func knownProvider(provider string) bool {
	provider = model.NormalizeModelIdentityValue(provider)
	providers := append([]string(nil), Provider...)
	sort.Strings(providers)
	index := sort.SearchStrings(providers, provider)
	return index < len(providers) && providers[index] == provider
}

func providerFromCanonical(canonicalID, fallback string) string {
	canonicalID = model.NormalizeModelIdentityValue(canonicalID)
	provider, _, ok := strings.Cut(canonicalID, ":")
	if ok && provider != "model" && provider != "product" {
		return provider
	}
	return model.NormalizeModelIdentityValue(fallback)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
