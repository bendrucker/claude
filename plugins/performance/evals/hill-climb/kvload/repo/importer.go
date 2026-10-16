package main

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

type Record struct {
	Key      string            `json:"key"`
	Customer string            `json:"customer"`
	Email    string            `json:"email"`
	Country  string            `json:"country"`
	Total    int64             `json:"total_cents"`
	Lines    []Line            `json:"lines"`
	Tags     map[string]string `json:"tags,omitempty"`
}

type Line struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"qty"`
	Cents    int64  `json:"cents"`
}

// Import reads one record per line, normalizes it, and stores it.
func Import(st *Store, r *bufio.Reader) (int, error) {
	n := 0
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			var rec Record
			if err := json.Unmarshal(line, &rec); err != nil {
				return n, err
			}
			normalize(&rec)
			if err := st.Put(rec); err != nil {
				return n, err
			}
			n++
		}
		if err == io.EOF {
			return n, nil
		}
		if err != nil {
			return n, err
		}
	}
}

func normalize(r *Record) {
	r.Email = strings.ToLower(strings.TrimSpace(r.Email))
	r.Country = strings.ToUpper(r.Country)
	for i := range r.Lines {
		r.Lines[i].SKU = strings.ToUpper(strings.TrimSpace(r.Lines[i].SKU))
	}
	for k, v := range r.Tags {
		r.Tags[k] = strings.ToLower(v)
	}
}
