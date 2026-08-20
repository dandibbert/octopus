package rewrite

import (
	"sync"
)

type planCache struct {
	mu      sync.Mutex
	entries map[string]*Plan
	order   []string
}

var compiledPlans = &planCache{entries: make(map[string]*Plan)}

func cacheKey(scope Scope, hash string) string {
	return string(scope) + ":" + hash
}

func CompileCached(raw *string, scope Scope) (*Plan, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	decoded, err := decodeRaw(raw)
	if err != nil {
		return nil, err
	}
	if decoded == nil || decoded.Config == nil {
		return nil, nil
	}
	key := cacheKey(scope, decoded.RawHash)
	if plan := compiledPlans.get(key); plan != nil {
		return plan, nil
	}
	plan, err := compileConfig(decoded.Config, scope, decoded.Legacy, decoded.RawHash)
	if err != nil {
		return nil, err
	}
	compiledPlans.put(key, plan)
	return plan, nil
}

func WarmCache(raw *string, scope Scope) error {
	_, err := CompileCached(raw, scope)
	return err
}

func (c *planCache) get(key string) *Plan {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.entries[key]
}

func (c *planCache) put(key string, plan *Plan) {
	if plan == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; ok {
		c.entries[key] = plan
		return
	}
	if len(c.entries) >= MaxPlanCache {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.entries, oldest)
	}
	c.entries[key] = plan
	c.order = append(c.order, key)
}
