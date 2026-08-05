package op

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
)

var modelAliasCache = cache.New[string, model.ModelAlias](16)

func ModelAliasList(ctx context.Context) ([]model.ModelAlias, error) {
	aliases := make([]model.ModelAlias, 0, modelAliasCache.Len())
	for _, alias := range modelAliasCache.GetAll() {
		aliases = append(aliases, alias)
	}
	sort.Slice(aliases, func(i, j int) bool {
		if aliases[i].ScopeKey == aliases[j].ScopeKey {
			if aliases[i].Priority == aliases[j].Priority {
				return aliases[i].Alias < aliases[j].Alias
			}
			return aliases[i].Priority > aliases[j].Priority
		}
		return aliases[i].ScopeKey < aliases[j].ScopeKey
	})
	return aliases, nil
}

func ModelAliasCreate(alias *model.ModelAlias, ctx context.Context) error {
	if alias == nil {
		return fmt.Errorf("alias is required")
	}
	normalizeModelAlias(alias)
	if err := validateModelAlias(*alias); err != nil {
		return err
	}
	if _, ok := modelAliasCache.Get(modelAliasCacheKey(alias.ScopeKey, alias.Alias)); ok {
		return fmt.Errorf("alias already exists in this scope")
	}
	if err := db.GetDB().WithContext(ctx).Create(alias).Error; err != nil {
		return err
	}
	modelAliasCache.Set(modelAliasCacheKey(alias.ScopeKey, alias.Alias), *alias)
	return nil
}

func ModelAliasUpdate(alias *model.ModelAlias, ctx context.Context) error {
	if alias == nil || alias.ID <= 0 {
		return fmt.Errorf("alias id is required")
	}
	var existing model.ModelAlias
	if err := db.GetDB().WithContext(ctx).First(&existing, alias.ID).Error; err != nil {
		return fmt.Errorf("alias not found: %w", err)
	}
	oldKey := modelAliasCacheKey(existing.ScopeKey, existing.Alias)
	alias.CreatedAt = existing.CreatedAt
	normalizeModelAlias(alias)
	if err := validateModelAlias(*alias); err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Save(alias).Error; err != nil {
		return err
	}
	modelAliasCache.Del(oldKey)
	modelAliasCache.Set(modelAliasCacheKey(alias.ScopeKey, alias.Alias), *alias)
	return nil
}

func ModelAliasDelete(id int64, ctx context.Context) error {
	if id <= 0 {
		return fmt.Errorf("alias id is required")
	}
	var alias model.ModelAlias
	if err := db.GetDB().WithContext(ctx).First(&alias, id).Error; err != nil {
		return fmt.Errorf("alias not found: %w", err)
	}
	if err := db.GetDB().WithContext(ctx).Delete(&alias).Error; err != nil {
		return err
	}
	modelAliasCache.Del(modelAliasCacheKey(alias.ScopeKey, alias.Alias))
	return nil
}

// ModelAliasUpsertAuto creates or refreshes a system-derived alias without
// overwriting an administrator-managed alias in the same scope.
func ModelAliasUpsertAuto(alias *model.ModelAlias, ctx context.Context) error {
	if alias == nil {
		return fmt.Errorf("alias is required")
	}
	normalizeModelAlias(alias)
	alias.Source = "auto"
	alias.Enabled = true
	if err := validateModelAlias(*alias); err != nil {
		return err
	}
	key := modelAliasCacheKey(alias.ScopeKey, alias.Alias)
	if existing, ok := modelAliasCache.Get(key); ok {
		if strings.EqualFold(existing.Source, "user") {
			return nil
		}
		alias.ID = existing.ID
		alias.CreatedAt = existing.CreatedAt
		if err := db.GetDB().WithContext(ctx).Save(alias).Error; err != nil {
			return err
		}
		modelAliasCache.Set(key, *alias)
		return nil
	}
	if err := db.GetDB().WithContext(ctx).Create(alias).Error; err != nil {
		return err
	}
	modelAliasCache.Set(key, *alias)
	return nil
}

func ModelAliasResolve(channelID int, provider, rawAlias string) (model.ModelAlias, string, bool) {
	rawAlias = model.NormalizeModelIdentityValue(rawAlias)
	provider = model.NormalizeModelIdentityValue(provider)
	if rawAlias == "" {
		return model.ModelAlias{}, "", false
	}
	if channelID > 0 {
		scope := "channel:" + fmt.Sprintf("%d", channelID)
		if alias, ok := modelAliasCache.Get(modelAliasCacheKey(scope, rawAlias)); ok && alias.Enabled {
			return alias, "channel_alias", true
		}
	}
	if provider != "" {
		scope := "provider:" + provider
		if alias, ok := modelAliasCache.Get(modelAliasCacheKey(scope, rawAlias)); ok && alias.Enabled {
			return alias, "provider_alias", true
		}
	}
	if alias, ok := modelAliasCache.Get(modelAliasCacheKey("global", rawAlias)); ok && alias.Enabled {
		return alias, "alias", true
	}
	return model.ModelAlias{}, "", false
}

func modelAliasRefreshCache(ctx context.Context) error {
	var aliases []model.ModelAlias
	if err := db.GetDB().WithContext(ctx).Find(&aliases).Error; err != nil {
		return err
	}
	modelAliasCache.Clear()
	for _, alias := range aliases {
		normalizeModelAlias(&alias)
		modelAliasCache.Set(modelAliasCacheKey(alias.ScopeKey, alias.Alias), alias)
	}
	return nil
}

func normalizeModelAlias(alias *model.ModelAlias) {
	alias.Provider = model.NormalizeModelIdentityValue(alias.Provider)
	alias.Alias = model.NormalizeModelIdentityValue(alias.Alias)
	alias.CanonicalModelID = model.NormalizeModelIdentityValue(alias.CanonicalModelID)
	alias.BillingClassID = model.NormalizeModelIdentityValue(alias.BillingClassID)
	alias.ScopeKey = model.ModelAliasScopeKey(alias.ChannelID, alias.Provider)
	if strings.TrimSpace(alias.Source) == "" {
		alias.Source = "user"
	}
}

func validateModelAlias(alias model.ModelAlias) error {
	if alias.Alias == "" {
		return fmt.Errorf("alias is required")
	}
	if alias.CanonicalModelID == "" {
		return fmt.Errorf("canonical model id is required")
	}
	if alias.ChannelID != nil && *alias.ChannelID <= 0 {
		return fmt.Errorf("channel id must be positive")
	}
	if alias.ChannelID != nil && alias.Provider != "" {
		return fmt.Errorf("channel and provider scopes are mutually exclusive")
	}
	return nil
}

func modelAliasCacheKey(scope, alias string) string {
	return strings.TrimSpace(scope) + "\x00" + model.NormalizeModelIdentityValue(alias)
}
