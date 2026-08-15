package price

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
)

const (
	ModelAliasAttachCodeInvalidRequest      = "model_alias.attach.invalid_request"
	ModelAliasAttachCodeTargetPriceUnknown  = "model_alias.attach.target_price_unknown"
	ModelAliasAttachCodeSourcePriceConflict = "model_alias.attach.source_price_conflict"
	ModelAliasAttachCodeAliasConflict       = "model_alias.attach.alias_conflict"
)

type ModelAliasAttachError struct {
	Code string
	Err  error
}

func (e *ModelAliasAttachError) Error() string { return e.Err.Error() }
func (e *ModelAliasAttachError) Unwrap() error { return e.Err }

var errAttachTargetIdentityMismatch = errors.New("target canonical model and billing class do not identify the same priced model")

func AttachModelAlias(ctx context.Context, req model.ModelAliasAttachRequest) (model.ModelAliasAttachResponse, error) {
	req.Alias = model.NormalizeModelIdentityValue(req.Alias)
	req.CanonicalModelID = model.NormalizeModelIdentityValue(req.CanonicalModelID)
	req.BillingClassID = model.NormalizeModelIdentityValue(req.BillingClassID)
	req.Provider = model.NormalizeModelIdentityValue(req.Provider)
	req.ConflictPolicy = strings.ToLower(strings.TrimSpace(req.ConflictPolicy))
	if req.ConflictPolicy == "" {
		req.ConflictPolicy = model.ModelAliasConflictReject
	}
	if err := validateAttachRequest(req); err != nil {
		return model.ModelAliasAttachResponse{}, attachError(ModelAliasAttachCodeInvalidRequest, err)
	}
	if req.ChannelID != nil {
		if _, err := op.ChannelGet(*req.ChannelID, ctx); err != nil {
			return model.ModelAliasAttachResponse{}, attachError(
				ModelAliasAttachCodeInvalidRequest,
				fmt.Errorf("channel %d does not exist", *req.ChannelID),
			)
		}
	}

	targetResolution, targetPrice, err := resolveAttachTarget(ctx, req)
	if err != nil {
		if errors.Is(err, errAttachTargetIdentityMismatch) {
			return model.ModelAliasAttachResponse{}, attachError(ModelAliasAttachCodeInvalidRequest, err)
		}
		return model.ModelAliasAttachResponse{}, attachError(ModelAliasAttachCodeTargetPriceUnknown, err)
	}
	if !usableAttachTargetPrice(targetPrice) {
		return model.ModelAliasAttachResponse{}, attachError(
			ModelAliasAttachCodeTargetPriceUnknown,
			fmt.Errorf("target price identity %q does not resolve to a known price", req.CanonicalModelID),
		)
	}
	channelID := 0
	if req.ChannelID != nil {
		channelID = *req.ChannelID
	}
	if sourceHasIndependentPrice(req.Alias, req.Provider, channelID) {
		return model.ModelAliasAttachResponse{}, attachError(
			ModelAliasAttachCodeSourcePriceConflict,
			fmt.Errorf("source model %q already has an effective price", req.Alias),
		)
	}
	if targetResolution.CanonicalModelID == "" {
		return model.ModelAliasAttachResponse{}, attachError(
			ModelAliasAttachCodeTargetPriceUnknown,
			fmt.Errorf("target price identity %q has no canonical model", req.CanonicalModelID),
		)
	}

	alias := model.ModelAlias{
		ChannelID:        req.ChannelID,
		Provider:         req.Provider,
		Alias:            req.Alias,
		CanonicalModelID: targetResolution.CanonicalModelID,
		BillingClassID:   targetPrice.BillingClassID,
		Source:           "user",
		Enabled:          true,
	}
	// Channel Alias 不能同时属于 Provider 作用域；Provider 仅作为本次解析上下文。
	if alias.ChannelID != nil {
		alias.Provider = ""
	}
	if err := op.ModelAliasAttach(&alias, req.ConflictPolicy, ctx); err != nil {
		switch {
		case errors.Is(err, op.ErrModelAliasSourcePriceConflict):
			return model.ModelAliasAttachResponse{}, attachError(ModelAliasAttachCodeSourcePriceConflict, err)
		case errors.Is(err, op.ErrModelAliasConflict):
			return model.ModelAliasAttachResponse{}, attachError(ModelAliasAttachCodeAliasConflict, err)
		default:
			return model.ModelAliasAttachResponse{}, err
		}
	}

	// 事务提交前目标身份和价格已经完整冻结；提交后只使用刚写入的 Alias 构造响应，
	// 不再执行可能失败的查询，避免出现“接口返回 500 但 Alias 已经落库”。
	method := "alias"
	if req.ChannelID != nil {
		method = "channel_alias"
	} else if req.Provider != "" {
		method = "provider_alias"
	}
	aliasID := alias.ID
	finalResolution := model.ModelResolution{
		RawModel:         req.Alias,
		NormalizedModel:  req.Alias,
		Provider:         providerFromCanonical(alias.CanonicalModelID, req.Provider),
		CanonicalModelID: alias.CanonicalModelID,
		BillingClassID:   alias.BillingClassID,
		Method:           method,
		Confidence:       100,
		AliasID:          &aliasID,
		Status:           model.BillingStatusResolved,
	}
	finalPrice := targetPrice
	finalPrice.Method = method
	return model.ModelAliasAttachResponse{
		Alias:           alias,
		ModelResolution: finalResolution,
		PriceResolution: finalPrice,
	}, nil
}

func validateAttachRequest(req model.ModelAliasAttachRequest) error {
	if req.Alias == "" {
		return fmt.Errorf("alias is required")
	}
	if req.CanonicalModelID == "" {
		return fmt.Errorf("canonical model id is required")
	}
	if req.ChannelID != nil && *req.ChannelID <= 0 {
		return fmt.Errorf("channel id must be positive")
	}
	if req.ConflictPolicy != model.ModelAliasConflictReject && req.ConflictPolicy != model.ModelAliasConflictReplace {
		return fmt.Errorf("invalid conflict policy: %s", req.ConflictPolicy)
	}
	return nil
}

type attachTargetCandidate struct {
	resolution model.ModelResolution
	price      model.PriceResolution
}

func resolveAttachTarget(ctx context.Context, req model.ModelAliasAttachRequest) (model.ModelResolution, model.PriceResolution, error) {
	canonicalID := req.CanonicalModelID
	candidates := attachTargetCandidates(ctx, canonicalID)
	if len(candidates) == 0 {
		identity := resolveModelIdentityWithoutAlias(model.ModelResolveContext{
			RawModel: req.CanonicalModelID,
			Provider: req.Provider,
		})
		if identity.Status == model.BillingStatusResolved && identity.CanonicalModelID != "" {
			canonicalID = identity.CanonicalModelID
			candidates = attachTargetCandidates(ctx, canonicalID)
		}
	}
	if len(candidates) == 0 {
		return model.ModelResolution{}, model.PriceResolution{}, fmt.Errorf("target canonical model %q has no effective price", req.CanonicalModelID)
	}
	if req.BillingClassID != "" {
		for _, candidate := range candidates {
			if candidate.resolution.BillingClassID == req.BillingClassID {
				return candidate.resolution, candidate.price, nil
			}
		}
		return model.ModelResolution{}, model.PriceResolution{}, fmt.Errorf(
			"%w: canonical=%q billing_class=%q", errAttachTargetIdentityMismatch, canonicalID, req.BillingClassID,
		)
	}
	if len(candidates) != 1 {
		return model.ModelResolution{}, model.PriceResolution{}, fmt.Errorf(
			"%w: canonical=%q has multiple billing classes", errAttachTargetIdentityMismatch, canonicalID,
		)
	}
	return candidates[0].resolution, candidates[0].price, nil
}

func attachTargetCandidates(ctx context.Context, canonicalID string) []attachTargetCandidate {
	canonicalID = model.NormalizeModelIdentityValue(canonicalID)
	byBillingClass := make(map[string]attachTargetCandidate)
	if entry, ok := catalogEntryByCanonical(canonicalID); ok {
		resolution := catalogResolution(canonicalID, canonicalID, entry, "attach_target", 100, false)
		byBillingClass[resolution.BillingClassID] = attachTargetCandidate{
			resolution: resolution,
			price:      catalogPriceResolution(entry, "attach_target"),
		}
	}
	infos, err := op.LLMList(ctx)
	if err == nil {
		for _, info := range infos {
			if model.NormalizeModelIdentityValue(info.CanonicalModelID) != canonicalID {
				continue
			}
			priceResolution, ok := userPriceResolution(info, "attach_target")
			if !ok || !usableAttachTargetPrice(priceResolution) {
				continue
			}
			billingClassID := model.NormalizeModelIdentityValue(priceResolution.BillingClassID)
			resolution := model.ModelResolution{
				RawModel:         canonicalID,
				NormalizedModel:  canonicalID,
				Provider:         providerFromCanonical(canonicalID, info.Provider),
				CanonicalModelID: canonicalID,
				BillingClassID:   billingClassID,
				Method:           "attach_target",
				Confidence:       100,
				Status:           model.BillingStatusResolved,
			}
			byBillingClass[billingClassID] = attachTargetCandidate{resolution: resolution, price: priceResolution}
		}
	}
	keys := make([]string, 0, len(byBillingClass))
	for key := range byBillingClass {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]attachTargetCandidate, 0, len(keys))
	for _, key := range keys {
		result = append(result, byBillingClass[key])
	}
	return result
}

func sourceHasIndependentPrice(rawModel, provider string, channelID int) bool {
	resolution := resolveModelIdentityWithoutAlias(model.ModelResolveContext{
		RawModel:  rawModel,
		Provider:  provider,
		ChannelID: channelID,
	})
	if usableAttachTargetPrice(ResolvePrice(resolution)) {
		return true
	}
	// 无 Provider 的同名模型可能是 conflict，但仍然说明目录已有价格，不能重映射。
	return len(catalogCandidates(model.NormalizeModelIdentityValue(rawModel), provider)) > 0
}

func usableAttachTargetPrice(resolution model.PriceResolution) bool {
	if resolution.Price == nil {
		return false
	}
	if resolution.Status != model.BillingStatusResolved && resolution.Status != model.BillingStatusFree {
		return false
	}
	return resolution.PriceMode == model.PriceExplicit ||
		resolution.PriceMode == model.PriceFree ||
		resolution.PriceMode == model.PriceInherited
}

func attachError(code string, err error) error {
	return &ModelAliasAttachError{Code: code, Err: err}
}
