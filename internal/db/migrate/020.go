package migrate

import (
	"github.com/bestruirui/octopus/internal/model"
	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 20,
		Up:      migrateRewriteTemplates,
	})
}

func migrateRewriteTemplates(db *gorm.DB) error {
	return db.AutoMigrate(&model.RewriteTemplate{})
}
