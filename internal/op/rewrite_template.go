package op

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/rewrite"
	"gorm.io/gorm"
)

var (
	ErrRewriteTemplateNotFound = errors.New("rewrite template not found")
	ErrRewriteTemplateConflict = errors.New("rewrite template name already exists in this scope")
)

func normalizeRewriteTemplateScope(raw string) (rewrite.Scope, error) {
	scope := rewrite.Scope(strings.ToLower(strings.TrimSpace(raw)))
	switch scope {
	case rewrite.ScopeChannel, rewrite.ScopeGroup:
		return scope, nil
	default:
		return "", fmt.Errorf("invalid rewrite template scope %q", raw)
	}
}

func validateRewriteTemplate(tpl *model.RewriteTemplate) error {
	if tpl == nil {
		return fmt.Errorf("rewrite template is required")
	}
	tpl.Name = strings.TrimSpace(tpl.Name)
	tpl.Description = strings.TrimSpace(tpl.Description)
	if tpl.Name == "" {
		return fmt.Errorf("rewrite template name is required")
	}
	if len(tpl.Name) > 128 {
		return fmt.Errorf("rewrite template name exceeds 128 bytes")
	}
	if len(tpl.Description) > 512 {
		return fmt.Errorf("rewrite template description exceeds 512 bytes")
	}
	scope, err := normalizeRewriteTemplateScope(tpl.Scope)
	if err != nil {
		return err
	}
	tpl.Scope = string(scope)
	config := strings.TrimSpace(tpl.Config)
	if err := rewrite.ValidateTemplateRawConfig(&config, scope); err != nil {
		return err
	}
	tpl.Config = config
	return nil
}

func RewriteTemplateList(scopeRaw string, ctx context.Context) ([]model.RewriteTemplate, error) {
	query := db.GetDB().WithContext(ctx).Model(&model.RewriteTemplate{})
	if strings.TrimSpace(scopeRaw) != "" {
		scope, err := normalizeRewriteTemplateScope(scopeRaw)
		if err != nil {
			return nil, err
		}
		query = query.Where("scope = ?", string(scope))
	}
	var templates []model.RewriteTemplate
	if err := query.Order("updated_at DESC, id DESC").Find(&templates).Error; err != nil {
		return nil, err
	}
	return templates, nil
}

func RewriteTemplateCreate(tpl *model.RewriteTemplate, ctx context.Context) error {
	if err := validateRewriteTemplate(tpl); err != nil {
		return err
	}
	var count int64
	if err := db.GetDB().WithContext(ctx).Model(&model.RewriteTemplate{}).
		Where("scope = ? AND name = ?", tpl.Scope, tpl.Name).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrRewriteTemplateConflict
	}
	if err := db.GetDB().WithContext(ctx).Create(tpl).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrRewriteTemplateConflict
		}
		return err
	}
	return nil
}

func RewriteTemplateUpdate(tpl *model.RewriteTemplate, ctx context.Context) error {
	if tpl == nil || tpl.ID <= 0 {
		return fmt.Errorf("rewrite template id is required")
	}
	var existing model.RewriteTemplate
	if err := db.GetDB().WithContext(ctx).First(&existing, tpl.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrRewriteTemplateNotFound
		}
		return err
	}
	if err := validateRewriteTemplate(tpl); err != nil {
		return err
	}
	tpl.CreatedAt = existing.CreatedAt
	var count int64
	if err := db.GetDB().WithContext(ctx).Model(&model.RewriteTemplate{}).
		Where("scope = ? AND name = ? AND id <> ?", tpl.Scope, tpl.Name, tpl.ID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrRewriteTemplateConflict
	}
	if err := db.GetDB().WithContext(ctx).Save(tpl).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrRewriteTemplateConflict
		}
		return err
	}
	return nil
}

func RewriteTemplateDelete(id int64, ctx context.Context) error {
	if id <= 0 {
		return fmt.Errorf("rewrite template id is required")
	}
	result := db.GetDB().WithContext(ctx).Delete(&model.RewriteTemplate{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRewriteTemplateNotFound
	}
	return nil
}
