package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Pricing is a client for the pricing service's batch endpoint.
type Pricing struct {
	base   string
	client *http.Client
}

func NewPricing(base string) *Pricing {
	return &Pricing{base: base, client: &http.Client{Timeout: 5 * time.Second}}
}

func (p *Pricing) Fetch(symbols []string) ([]Quote, error) {
	u := fmt.Sprintf("%s/v2/quotes?symbols=%s", p.base, url.QueryEscape(strings.Join(symbols, ",")))
	resp, err := p.client.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pricing: %s", resp.Status)
	}
	var quotes []Quote
	if err := json.NewDecoder(resp.Body).Decode(&quotes); err != nil {
		return nil, err
	}
	return quotes, nil
}
