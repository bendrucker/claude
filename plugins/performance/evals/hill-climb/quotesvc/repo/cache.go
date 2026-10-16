package main

import (
	"log"
	"sync"
	"time"
)

type Quote struct {
	Symbol string
	Bid    int64
	Ask    int64
	AsOf   time.Time
}

// Cache holds the latest quote per symbol, refreshed from the pricing service.
type Cache struct {
	mu      sync.RWMutex
	quotes  map[string]Quote
	pricing *Pricing
}

func NewCache(p *Pricing, symbols []string) *Cache {
	quotes := make(map[string]Quote, len(symbols))
	for _, s := range symbols {
		quotes[s] = Quote{Symbol: s}
	}
	return &Cache{quotes: quotes, pricing: p}
}

func (c *Cache) Get(symbol string) (Quote, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	q, ok := c.quotes[symbol]
	return q, ok
}

func (c *Cache) RefreshEvery(d time.Duration) {
	for range time.Tick(d) {
		if err := c.refresh(); err != nil {
			log.Printf("refresh: %v", err)
		}
	}
}

// refresh replaces every quote in one step, so readers never see a mix of
// old and new prices.
func (c *Cache) refresh() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	symbols := make([]string, 0, len(c.quotes))
	for s := range c.quotes {
		symbols = append(symbols, s)
	}
	fresh, err := c.pricing.Fetch(symbols)
	if err != nil {
		return err
	}
	for _, q := range fresh {
		c.quotes[q.Symbol] = q
	}
	return nil
}
