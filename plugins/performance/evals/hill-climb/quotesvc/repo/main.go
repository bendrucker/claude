// Command quotesvc serves cached price quotes over HTTP.
package main

import (
	"flag"
	"log"
	"net/http"
	"strings"
	"time"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	upstream := flag.String("upstream", "http://pricing.internal:9000", "pricing service base URL")
	symbols := flag.String("symbols", "", "comma-separated symbols to serve")
	every := flag.Duration("refresh", 2*time.Second, "cache refresh interval")
	flag.Parse()

	cache := NewCache(NewPricing(*upstream), strings.Split(*symbols, ","))
	if err := cache.refresh(); err != nil {
		log.Fatal(err)
	}
	go cache.RefreshEvery(*every)

	mux := http.NewServeMux()
	mux.Handle("/quote", quoteHandler(cache))
	log.Fatal(http.ListenAndServe(*addr, mux))
}
