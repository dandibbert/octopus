package price

import (
	"sort"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
)

type catalogEntry struct {
	Provider         string
	ModelID          string
	CanonicalModelID string
	BillingClassID   string
	Price            model.LLMPrice
	Source           string
	Version          string
}

var builtinCatalog = make(map[string]catalogEntry)
var remoteCatalog = make(map[string]catalogEntry)

func init() {
	entries := make(map[string]catalogEntry, len(llmPrice))
	for modelID, modelPrice := range llmPrice {
		provider := inferProvider(modelID)
		entry := newCatalogEntry(provider, modelID, modelPrice, "builtin", "builtin")
		entries[entry.CanonicalModelID] = entry
	}
	builtinCatalog = entries
}

func newCatalogEntry(provider, modelID string, price model.LLMPrice, source, version string) catalogEntry {
	provider = model.NormalizeModelIdentityValue(provider)
	modelID = model.NormalizeModelIdentityValue(modelID)
	canonicalID := canonicalModelID(provider, modelID)
	return catalogEntry{
		Provider:         provider,
		ModelID:          modelID,
		CanonicalModelID: canonicalID,
		BillingClassID:   canonicalBillingClassID(canonicalID),
		Price:            price,
		Source:           source,
		Version:          version,
	}
}

func replaceRemoteCatalog(entries map[string]catalogEntry) {
	llmPriceLock.Lock()
	remoteCatalog = entries
	llmPriceLock.Unlock()
}

func catalogEntryByCanonical(canonicalID string) (catalogEntry, bool) {
	canonicalID = model.NormalizeModelIdentityValue(canonicalID)
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()
	if entry, ok := remoteCatalog[canonicalID]; ok {
		return entry, true
	}
	entry, ok := builtinCatalog[canonicalID]
	return entry, ok
}

func catalogEntryByBillingClass(billingClassID string) (catalogEntry, bool) {
	billingClassID = model.NormalizeModelIdentityValue(billingClassID)
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()
	for _, catalog := range []map[string]catalogEntry{remoteCatalog, builtinCatalog} {
		for _, entry := range catalog {
			if entry.BillingClassID == billingClassID {
				return entry, true
			}
		}
	}
	return catalogEntry{}, false
}

func catalogCandidates(modelID, provider string) []catalogEntry {
	modelID = model.NormalizeModelIdentityValue(modelID)
	provider = model.NormalizeModelIdentityValue(provider)
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()
	seen := make(map[string]struct{})
	result := make([]catalogEntry, 0, 2)
	for _, catalog := range []map[string]catalogEntry{remoteCatalog, builtinCatalog} {
		for _, entry := range catalog {
			if entry.ModelID != modelID {
				continue
			}
			if provider != "" && entry.Provider != provider {
				continue
			}
			if _, ok := seen[entry.CanonicalModelID]; ok {
				continue
			}
			seen[entry.CanonicalModelID] = struct{}{}
			result = append(result, entry)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CanonicalModelID < result[j].CanonicalModelID
	})
	return result
}

func catalogProviderModels(provider string) []catalogEntry {
	provider = model.NormalizeModelIdentityValue(provider)
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()
	seen := make(map[string]struct{})
	result := make([]catalogEntry, 0)
	for _, catalog := range []map[string]catalogEntry{remoteCatalog, builtinCatalog} {
		for _, entry := range catalog {
			if provider != "" && entry.Provider != provider {
				continue
			}
			if _, ok := seen[entry.CanonicalModelID]; ok {
				continue
			}
			seen[entry.CanonicalModelID] = struct{}{}
			result = append(result, entry)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if len(result[i].ModelID) == len(result[j].ModelID) {
			if result[i].ModelID == result[j].ModelID {
				return result[i].CanonicalModelID < result[j].CanonicalModelID
			}
			return result[i].ModelID < result[j].ModelID
		}
		return len(result[i].ModelID) > len(result[j].ModelID)
	})
	return result
}

// ListCatalogLLMInfo returns the effective remote/builtin catalog as
// read-only rows for the management UI. These rows are not persisted to
// llm_infos; editing one creates a user override instead.
func ListCatalogLLMInfo() []model.LLMInfo {
	entries := catalogProviderModels("")
	result := make([]model.LLMInfo, 0, len(entries))
	for _, entry := range entries {
		priceCopy := entry.Price
		result = append(result, model.LLMInfo{
			Name:                  entry.ModelID,
			Provider:              entry.Provider,
			CanonicalModelID:      entry.CanonicalModelID,
			BillingClassID:        entry.BillingClassID,
			PriceMode:             model.PriceExplicit,
			PriceSource:           entry.Source,
			PriceVersion:          entry.Version,
			EffectivePrice:        &priceCopy,
			EffectivePriceSource:  entry.Source,
			EffectivePriceVersion: entry.Version,
			ResolutionStatus:      model.BillingStatusResolved,
			ResolutionMethod:      "catalog",
			ModelType:             "catalog",
			CatalogOnly:           true,
			LLMPrice:              entry.Price,
		})
	}
	return result
}

// MergeCatalogLLMInfo overlays persisted administrator/auto-discovered rows
// on the catalog. A stored row with the same model name wins, so deleting a
// user override naturally reveals the catalog price again.
func MergeCatalogLLMInfo(stored []model.LLMInfo) []model.LLMInfo {
	catalog := ListCatalogLLMInfo()
	result := make([]model.LLMInfo, 0, len(stored)+len(catalog))
	seenNames := make(map[string]struct{}, len(stored))
	for _, info := range stored {
		name := model.NormalizeModelIdentityValue(info.Name)
		if name == "" {
			continue
		}
		seenNames[name] = struct{}{}
		result = append(result, info)
	}
	for _, info := range catalog {
		name := model.NormalizeModelIdentityValue(info.Name)
		if _, exists := seenNames[name]; exists {
			continue
		}
		seenNames[name] = struct{}{}
		result = append(result, info)
	}
	return result
}

func canonicalModelID(provider, modelID string) string {
	provider = model.NormalizeModelIdentityValue(provider)
	modelID = model.NormalizeModelIdentityValue(modelID)
	if strings.Contains(modelID, ":") {
		return modelID
	}
	if provider == "" {
		return "model:" + modelID
	}
	return provider + ":" + modelID
}

func canonicalBillingClassID(canonicalID string) string {
	canonicalID = model.NormalizeModelIdentityValue(canonicalID)
	if canonicalID == "" {
		return ""
	}
	if strings.HasSuffix(canonicalID, "/default") {
		return canonicalID
	}
	return canonicalID + "/default"
}

func inferProvider(modelID string) string {
	name := model.NormalizeModelIdentityValue(modelID)
	switch {
	case strings.HasPrefix(name, "claude-"):
		return "anthropic"
	case strings.HasPrefix(name, "gemini-"), strings.HasPrefix(name, "imagen-"):
		return "google"
	case strings.HasPrefix(name, "deepseek-"):
		return "deepseek"
	case strings.HasPrefix(name, "grok-"):
		return "xai"
	case strings.HasPrefix(name, "qwen-"):
		return "alibaba"
	case strings.HasPrefix(name, "glm-"):
		return "zhipuai"
	case strings.HasPrefix(name, "minimax-"):
		return "minimax"
	case strings.HasPrefix(name, "kimi-"), strings.HasPrefix(name, "moonshot-"):
		return "moonshotai"
	case strings.HasPrefix(name, "v0-"):
		return "v0"
	case strings.HasPrefix(name, "gpt-"), strings.HasPrefix(name, "chatgpt-"),
		strings.HasPrefix(name, "o1"), strings.HasPrefix(name, "o3"), strings.HasPrefix(name, "o4"),
		strings.HasPrefix(name, "text-embedding-"), strings.HasPrefix(name, "dall-e-"):
		return "openai"
	default:
		return ""
	}
}

func remoteCatalogVersion(at time.Time) string {
	if at.IsZero() {
		return "remote"
	}
	return at.UTC().Format(time.RFC3339)
}
