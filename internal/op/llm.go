package op

import (
	"context"
	"fmt"
	"strings"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
)

var llmModelCache = cache.New[string, model.LLMInfo](16)
var llmBillingClassCache = cache.New[string, model.LLMInfo](16)

func LLMList(ctx context.Context) ([]model.LLMInfo, error) {
	models := make([]model.LLMInfo, 0, llmModelCache.Len())
	for _, info := range llmModelCache.GetAll() {
		models = append(models, info)
	}
	return models, nil
}

func LLMUpdate(info model.LLMInfo, ctx context.Context) error {
	name := model.NormalizeModelIdentityValue(info.Name)
	existing, ok := llmModelCache.Get(name)
	if !ok {
		return fmt.Errorf("model not found")
	}
	info.Name = name
	info.CreatedAt = existing.CreatedAt
	if strings.TrimSpace(info.Provider) == "" {
		info.Provider = existing.Provider
	}
	if strings.TrimSpace(info.CanonicalModelID) == "" {
		info.CanonicalModelID = existing.CanonicalModelID
	}
	if strings.TrimSpace(info.BillingClassID) == "" {
		info.BillingClassID = existing.BillingClassID
	}
	if info.PriceMode == "" && existing.PriceMode == model.PriceFree && priceIsZero(info.LLMPrice) {
		info.PriceMode = model.PriceFree
	}
	info.AutoDiscovered = false
	info.PriceSource = "user"
	if err := validateUserLLMInfo(info); err != nil {
		return err
	}
	info = normalizeLLMInfo(info, false)
	if err := ensureUniqueUserBillingClass(info, ctx); err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Save(&info).Error; err != nil {
		return err
	}
	cacheLLMInfo(info)
	return nil
}

func LLMDelete(modelName string, ctx context.Context) error {
	modelName = model.NormalizeModelIdentityValue(modelName)
	info, ok := llmModelCache.Get(modelName)
	if !ok {
		return fmt.Errorf("model not found")
	}
	if err := db.GetDB().WithContext(ctx).Delete(&model.LLMInfo{Name: modelName}).Error; err != nil {
		return err
	}
	llmModelCache.Del(modelName)
	if info.BillingClassID != "" {
		llmBillingClassCache.Del(model.NormalizeModelIdentityValue(info.BillingClassID))
	}
	return nil
}

func LLMBatchDelete(modelNames []string, ctx context.Context) error {
	if len(modelNames) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(modelNames))
	for _, name := range modelNames {
		name = model.NormalizeModelIdentityValue(name)
		if name != "" {
			normalized = append(normalized, name)
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	if err := db.GetDB().WithContext(ctx).Where("name IN ?", normalized).Delete(&model.LLMInfo{}).Error; err != nil {
		return err
	}
	for _, name := range normalized {
		if info, ok := llmModelCache.Get(name); ok && info.BillingClassID != "" {
			llmBillingClassCache.Del(model.NormalizeModelIdentityValue(info.BillingClassID))
		}
	}
	llmModelCache.Del(normalized...)
	return nil
}

func LLMCreate(info model.LLMInfo, ctx context.Context) error {
	info.Name = model.NormalizeModelIdentityValue(info.Name)
	if info.Name == "" {
		return fmt.Errorf("model name is required")
	}
	if _, ok := llmModelCache.Get(info.Name); ok {
		return fmt.Errorf("model already exists")
	}
	info.AutoDiscovered = false
	info.PriceSource = "user"
	if err := validateUserLLMInfo(info); err != nil {
		return err
	}
	info = normalizeLLMInfo(info, false)
	if err := ensureUniqueUserBillingClass(info, ctx); err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Create(&info).Error; err != nil {
		return err
	}
	cacheLLMInfo(info)
	return nil
}

func LLMBatchCreate(llmInfos []model.LLMInfo, ctx context.Context) error {
	if len(llmInfos) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(llmInfos))
	newLLMInfos := make([]model.LLMInfo, 0, len(llmInfos))
	for _, info := range llmInfos {
		info.Name = model.NormalizeModelIdentityValue(info.Name)
		if info.Name == "" {
			continue
		}
		if _, ok := seen[info.Name]; ok {
			continue
		}
		if _, ok := llmModelCache.Get(info.Name); ok {
			continue
		}
		seen[info.Name] = struct{}{}
		info = normalizeLLMInfo(info, info.AutoDiscovered)
		newLLMInfos = append(newLLMInfos, info)
	}
	if len(newLLMInfos) == 0 {
		return nil
	}
	if err := db.GetDB().WithContext(ctx).Create(&newLLMInfos).Error; err != nil {
		return err
	}
	for _, info := range newLLMInfos {
		cacheLLMInfo(info)
	}
	return nil
}

// LLMUpsertDiscovered updates a system-discovered price identity while
// preserving any explicit administrator price/free decision.
func LLMUpsertDiscovered(info model.LLMInfo, ctx context.Context) error {
	info.Name = model.NormalizeModelIdentityValue(info.Name)
	if info.Name == "" {
		return fmt.Errorf("model name is required")
	}
	if existing, ok := llmModelCache.Get(info.Name); ok {
		if !existing.AutoDiscovered && strings.EqualFold(existing.PriceSource, "user") {
			return nil
		}
		if existing.PriceMode == model.PriceExplicit || existing.PriceMode == model.PriceFree {
			return nil
		}
		info.CreatedAt = existing.CreatedAt
	}
	info.AutoDiscovered = true
	if strings.TrimSpace(info.PriceSource) == "" {
		info.PriceSource = "auto"
	}
	info = normalizeLLMInfo(info, true)
	if err := db.GetDB().WithContext(ctx).Save(&info).Error; err != nil {
		return err
	}
	cacheLLMInfo(info)
	return nil
}

func LLMGet(name string) (model.LLMPrice, error) {
	info, err := LLMGetInfo(name)
	if err != nil {
		return model.LLMPrice{}, err
	}
	if info.PriceMode != model.PriceExplicit && info.PriceMode != model.PriceFree && info.PriceMode != model.PriceInherited {
		return model.LLMPrice{}, fmt.Errorf("model price is %s", info.PriceMode)
	}
	return info.LLMPrice, nil
}

func LLMGetInfo(name string) (model.LLMInfo, error) {
	name = model.NormalizeModelIdentityValue(name)
	info, ok := llmModelCache.Get(name)
	if !ok {
		return model.LLMInfo{}, fmt.Errorf("model not found")
	}
	return info, nil
}

func LLMGetByBillingClassID(billingClassID string) (model.LLMInfo, error) {
	billingClassID = model.NormalizeModelIdentityValue(billingClassID)
	if billingClassID == "" {
		return model.LLMInfo{}, fmt.Errorf("billing class is required")
	}
	info, ok := llmBillingClassCache.Get(billingClassID)
	if !ok {
		return model.LLMInfo{}, fmt.Errorf("billing class not found")
	}
	return info, nil
}

func llmRefreshCache(ctx context.Context) error {
	models := []model.LLMInfo{}
	if err := db.GetDB().WithContext(ctx).Find(&models).Error; err != nil {
		return err
	}
	llmModelCache.Clear()
	llmBillingClassCache.Clear()
	for _, info := range models {
		cacheLLMInfo(normalizeLLMInfo(info, info.AutoDiscovered))
	}
	return nil
}

func cacheLLMInfo(info model.LLMInfo) {
	info.Name = model.NormalizeModelIdentityValue(info.Name)
	llmModelCache.Set(info.Name, info)
	if info.BillingClassID != "" && (info.PriceMode == model.PriceExplicit || info.PriceMode == model.PriceFree) {
		llmBillingClassCache.Set(model.NormalizeModelIdentityValue(info.BillingClassID), info)
	}
}

func normalizeLLMInfo(info model.LLMInfo, autoDiscovered bool) model.LLMInfo {
	info.Name = model.NormalizeModelIdentityValue(info.Name)
	info.Provider = model.NormalizeModelIdentityValue(info.Provider)
	info.CanonicalModelID = model.NormalizeModelIdentityValue(info.CanonicalModelID)
	info.BillingClassID = model.NormalizeModelIdentityValue(info.BillingClassID)
	if info.CanonicalModelID == "" {
		info.CanonicalModelID = info.Name
	}
	if info.BillingClassID == "" {
		info.BillingClassID = info.CanonicalModelID
	}
	info.AutoDiscovered = autoDiscovered
	if !info.PriceMode.Valid() {
		if priceIsZero(info.LLMPrice) {
			info.PriceMode = model.PriceUnknown
		} else {
			info.PriceMode = model.PriceExplicit
		}
	}
	if info.PriceMode == model.PriceFree {
		info.LLMPrice = model.LLMPrice{}
		info.NeedsReview = false
	} else if info.PriceMode == model.PriceUnknown {
		info.NeedsReview = !autoDiscovered || info.NeedsReview
	} else {
		info.NeedsReview = false
	}
	if strings.TrimSpace(info.PriceSource) == "" {
		if autoDiscovered {
			info.PriceSource = "auto"
		} else {
			info.PriceSource = "user"
		}
	}
	return info
}

func priceIsZero(price model.LLMPrice) bool {
	return price.Input == 0 && price.Output == 0 && price.CacheRead == 0 && price.CacheWrite == 0
}

func validateUserLLMInfo(info model.LLMInfo) error {
	mode := info.PriceMode
	zero := priceIsZero(info.LLMPrice)
	if mode == "" {
		if zero {
			return fmt.Errorf("zero price must be explicitly marked as free or unknown")
		}
		mode = model.PriceExplicit
	}
	if !mode.Valid() {
		return fmt.Errorf("invalid price mode: %s", mode)
	}
	switch mode {
	case model.PriceExplicit:
		if zero {
			return fmt.Errorf("explicit price cannot be all zero; mark the model as free instead")
		}
	case model.PriceFree:
		if !zero {
			return fmt.Errorf("free price mode requires all prices to be zero")
		}
	case model.PriceUnknown:
		if !zero {
			return fmt.Errorf("unknown price mode requires all prices to be zero")
		}
	case model.PriceInherited:
		return fmt.Errorf("inherited price mode is managed by model aliases and auto discovery")
	}
	return nil
}

func ensureUniqueUserBillingClass(info model.LLMInfo, ctx context.Context) error {
	billingClassID := model.NormalizeModelIdentityValue(info.BillingClassID)
	if billingClassID == "" || (info.PriceMode != model.PriceExplicit && info.PriceMode != model.PriceFree) {
		return nil
	}
	var count int64
	if err := db.GetDB().WithContext(ctx).Model(&model.LLMInfo{}).
		Where("billing_class_id = ? AND price_mode IN ? AND name <> ?", billingClassID,
			[]model.PriceMode{model.PriceExplicit, model.PriceFree}, model.NormalizeModelIdentityValue(info.Name)).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("billing class %q already has an explicit user price", billingClassID)
	}
	return nil
}
