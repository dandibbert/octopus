package op

import (
	"errors"
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func TestRewriteTemplateCRUDAndScopeValidation(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	config := `{"$schema":"octopus.request-rewrite/v2","stage":"outbound_provider","operations":[{"id":"set-temp","op":"set","path":"/temperature","value":0.2}]}`
	tpl := &model.RewriteTemplate{Name: "OpenAI compatibility", Scope: "channel", Config: config}
	if err := RewriteTemplateCreate(tpl, ctx); err != nil {
		t.Fatal(err)
	}
	if tpl.ID <= 0 {
		t.Fatalf("template id not assigned: %+v", tpl)
	}

	list, err := RewriteTemplateList("channel", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != tpl.Name {
		t.Fatalf("unexpected template list: %+v", list)
	}

	duplicate := &model.RewriteTemplate{Name: tpl.Name, Scope: "channel", Config: config}
	if err := RewriteTemplateCreate(duplicate, ctx); !errors.Is(err, ErrRewriteTemplateConflict) {
		t.Fatalf("expected duplicate conflict, got %v", err)
	}

	tpl.Name = "Renamed"
	if err := RewriteTemplateUpdate(tpl, ctx); err != nil {
		t.Fatal(err)
	}
	if err := RewriteTemplateDelete(tpl.ID, ctx); err != nil {
		t.Fatal(err)
	}
	if err := RewriteTemplateDelete(tpl.ID, ctx); !errors.Is(err, ErrRewriteTemplateNotFound) {
		t.Fatalf("expected not found after delete, got %v", err)
	}
}

func TestRewriteTemplateRejectsLegacyAndSensitiveHeaders(t *testing.T) {
	ctx := setupModelAliasTestDB(t)
	legacy := &model.RewriteTemplate{Name: "legacy", Scope: "channel", Config: `{"temperature":0.2}`}
	if err := RewriteTemplateCreate(legacy, ctx); err == nil {
		t.Fatal("legacy template should be rejected")
	}
	sensitive := &model.RewriteTemplate{
		Name:   "sensitive",
		Scope:  "channel",
		Config: `{"$schema":"octopus.request-rewrite/v2","allow_sensitive_headers":true,"operations":[{"id":"auth","op":"header_set","header":"Authorization","value":"secret"}]}`,
	}
	if err := RewriteTemplateCreate(sensitive, ctx); err == nil {
		t.Fatal("sensitive header template should be rejected")
	}
	groupNextChannel := &model.RewriteTemplate{
		Name:   "bad-group-retry",
		Scope:  "group",
		Config: `{"$schema":"octopus.request-rewrite/v2","operations":[{"id":"reject","op":"return_error","error":{"message":"blocked","retry":"next_channel"}}]}`,
	}
	if err := RewriteTemplateCreate(groupNextChannel, ctx); err == nil {
		t.Fatal("group template should reject retry=next_channel")
	}
}
