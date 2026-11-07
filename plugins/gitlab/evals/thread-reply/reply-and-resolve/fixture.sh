#!/usr/bin/env bash
set -euo pipefail
stubs="$(dirname "$0")/../../../../../packages/eval-stubs"
bash "$stubs/install.sh"
source "$stubs/preamble.sh" https://gitlab.example.com/team/service.git

mkdir -p internal/ratelimit
cat > internal/ratelimit/limiter.go <<'GO'
package ratelimit

import "sync"

type Limiter struct {
	mu      sync.Mutex
	buckets map[string]float64
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.buckets[key]++
	return l.buckets[key] < 100
}
GO
cat > internal/ratelimit/middleware.go <<'GO'
package ratelimit

import "net/http"

func Middleware(l *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow(r.RemoteAddr) {
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
GO
BASE=$(commit "2026-09-01T10:00:00Z" "service: limiter skeleton")

git switch -qc ratelimit
cat > internal/ratelimit/limiter.go <<'GO'
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	count int
	last  time.Time
}

type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

// Evict drops buckets idle for longer than idle.
func (l *Limiter) Evict(idle time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, b := range l.buckets {
		if time.Since(b.last) > idle {
			delete(l.buckets, key)
		}
	}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{}
		l.buckets[key] = b
	}
	b.count++
	b.last = time.Now()
	return b.count < 100
}
GO
HEAD_SHA=$(commit_as "Priya Nair" priya@team.example.com "2026-09-11T16:00:00Z" "ratelimit: evict idle buckets")

git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/ratelimit "$HEAD_SHA"

jq -n --arg root "$PWD" --arg base "$BASE" --arg head "$HEAD_SHA" -f /dev/stdin > "$HOME/.eval-stubs/meta.json" <<'JQ'
def user($u): {"priya-n": {id: 31, username: "priya-n", name: "Priya Nair"}, "sam-o": {id: 44, username: "sam-o", name: "Sam Okafor"}, "lee-k": {id: 52, username: "lee-k", name: "Lee Kaplan"}}[$u];
def thread($id; $u; $note; $path; $line; $body): {
  id: $id,
  individual_note: false,
  notes: [{
    id: $note, type: "DiffNote", body: $body, author: user($u),
    created_at: "2026-09-10T09:00:00Z", updated_at: "2026-09-10T09:00:00Z", system: false,
    noteable_id: 89089, noteable_type: "MergeRequest", noteable_iid: 89,
    resolvable: true, resolved: false,
    position: {base_sha: $base, start_sha: $base, head_sha: $head, old_path: $path, new_path: $path, position_type: "text", old_line: null, new_line: $line}
  }]
};
{
  root: $root,
  host: "gitlab.example.com",
  project: "team/service",
  projectId: 1207,
  viewer: user("priya-n"),
  mr: {
    iid: 89,
    title: "Rate limit requests per client",
    description: "Adds a limiter in front of every route.",
    author: user("priya-n"),
    reviewers: [user("sam-o"), user("lee-k")],
    source_branch: "ratelimit",
    created_at: "2026-09-08T14:05:00Z",
    updated_at: "2026-09-11T16:30:00Z"
  },
  versions: [{id: 301, head: $head, base: $base, start: $base, created_at: "2026-09-11T16:02:00Z"}],
  discussions: [
    thread("3f8a1c6e9b2d4075a1e3c8d9f0b4a6e2c7d1f5a8"; "sam-o"; 5101; "internal/ratelimit/limiter.go"; 21; "`buckets` grows one entry per client forever. Evict idle buckets."),
    thread("b71d0e45a9c2486fd3e7a1b5c8f90d2e4a6c3b17"; "lee-k"; 5201; "internal/ratelimit/middleware.go"; 8; "`r.RemoteAddr` includes the source port, so each connection gets a fresh bucket. Key on the host part.")
  ]
}
JQ
