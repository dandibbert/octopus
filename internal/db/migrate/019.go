package migrate

import (
	"github.com/bestruirui/octopus/internal/model"
	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 19,
		Up:      migrateRelayLogRequestSource,
	})
}

func migrateRelayLogRequestSource(db *gorm.DB) error {
	if !db.Migrator().HasColumn(&model.RelayLog{}, "request_source") {
		if err := db.Migrator().AddColumn(&model.RelayLog{}, "RequestSource"); err != nil {
			return err
		}
	}
	// 不在启动迁移中回填历史大表。旧数据的 NULL/空值在读取和筛选时按 api
	// 处理，避免长事务、锁等待以及大量 WAL/redo log。
	return nil
}
