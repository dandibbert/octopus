package migrate

import (
	"database/sql"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestMigrateRelayLogRequestSourceDoesNotRewriteHistoryOrCreateIndex(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec("CREATE TABLE relay_logs (id INTEGER PRIMARY KEY, request_model_name TEXT)").Error; err != nil {
		t.Fatalf("create legacy relay_logs: %v", err)
	}
	if err := db.Exec("INSERT INTO relay_logs (id, request_model_name) VALUES (?, ?)", 1, "legacy-model").Error; err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}

	if err := migrateRelayLogRequestSource(db); err != nil {
		t.Fatalf("migrateRelayLogRequestSource: %v", err)
	}
	if !db.Migrator().HasColumn(&model.RelayLog{}, "request_source") {
		t.Fatal("request_source column was not added")
	}

	var source sql.NullString
	if err := db.Raw("SELECT request_source FROM relay_logs WHERE id = ?", 1).Scan(&source).Error; err != nil {
		t.Fatalf("read legacy request_source: %v", err)
	}
	if source.Valid {
		t.Fatalf("migration unexpectedly rewrote legacy row: %+v", source)
	}
	if db.Migrator().HasIndex("relay_logs", "idx_relay_logs_request_source") {
		t.Fatal("migration unexpectedly created a synchronous request_source index")
	}

	if err := migrateRelayLogRequestSource(db); err != nil {
		t.Fatalf("second migrateRelayLogRequestSource: %v", err)
	}
}
