package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

type quoteResponse struct {
	Symbol string `json:"symbol"`
	Bid    string `json:"bid"`
	Ask    string `json:"ask"`
	Spread string `json:"spread"`
	AsOf   string `json:"as_of"`
}

func quoteHandler(c *Cache) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		symbol := r.URL.Query().Get("sym")
		q, ok := c.Get(symbol)
		if !ok {
			http.Error(w, fmt.Sprintf("unknown symbol %q", symbol), http.StatusNotFound)
			return
		}
		resp := quoteResponse{
			Symbol: q.Symbol,
			Bid:    cents(q.Bid),
			Ask:    cents(q.Ask),
			Spread: cents(q.Ask - q.Bid),
			AsOf:   q.AsOf.UTC().Format("2006-01-02T15:04:05.000Z"),
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "max-age="+strconv.Itoa(1))
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}

func cents(v int64) string {
	return fmt.Sprintf("%d.%02d", v/100, v%100)
}
