package op

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func TestNewGroupModelMatcherExplicitRegexOverridesMode(t *testing.T) {
	group := model.Group{Name: "gpt", MatchRegex: "gggggg"}
	modes := []model.AutoGroupType{
		model.AutoGroupTypeFuzzy,
		model.AutoGroupTypeExact,
		model.AutoGroupTypeRegex,
	}

	for _, mode := range modes {
		matcher, err := newGroupModelMatcher(group, mode)
		if err != nil {
			t.Fatalf("newGroupModelMatcher(%d) returned error: %v", mode, err)
		}
		matched, err := matcher("gpt-4o")
		if err != nil {
			t.Fatalf("matcher(%d) returned error: %v", mode, err)
		}
		if matched {
			t.Fatalf("expected explicit non-matching regex to block fuzzy/exact fallback for mode %d", mode)
		}
	}
}

func TestNewGroupModelMatcherFallsBackToSelectedModeWithoutRegex(t *testing.T) {
	fuzzyMatcher, err := newGroupModelMatcher(model.Group{Name: "gpt"}, model.AutoGroupTypeFuzzy)
	if err != nil {
		t.Fatalf("fuzzy matcher returned error: %v", err)
	}
	matched, err := fuzzyMatcher("gpt-4o")
	if err != nil || !matched {
		t.Fatalf("expected fuzzy matcher to match group name, matched=%v err=%v", matched, err)
	}

	exactMatcher, err := newGroupModelMatcher(model.Group{Name: "gpt"}, model.AutoGroupTypeExact)
	if err != nil {
		t.Fatalf("exact matcher returned error: %v", err)
	}
	matched, err = exactMatcher("gpt-4o")
	if err != nil {
		t.Fatalf("exact matcher returned error: %v", err)
	}
	if matched {
		t.Fatalf("expected exact matcher not to match a different model name")
	}
}
