package main

import (
	"fmt"
	"io"
	"sort"
	"sync"
	"time"
)

// Stats counts pipeline events. Inc runs on the pipeline goroutine while a reporter reads.
type Stats struct {
	mu     sync.Mutex
	counts map[string]int
}

func NewStats() *Stats {
	return &Stats{counts: make(map[string]int)}
}

func (s *Stats) Inc(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counts[key]++
}

func (s *Stats) snapshot() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]int, len(s.counts))
	for k, v := range s.counts {
		out[k] = v
	}
	return out
}

// ReportEvery writes the counters to w each interval until the returned stop is called.
func (s *Stats) ReportEvery(interval time.Duration, w io.Writer) (stop func()) {
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				s.write(w)
			case <-done:
				return
			}
		}
	}()
	return func() {
		close(done)
		s.write(w)
	}
}

func (s *Stats) write(w io.Writer) {
	counts := s.snapshot()
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(w, "%s=%d ", k, counts[k])
	}
	fmt.Fprintln(w)
}
