#!/usr/bin/env bash
set -euo pipefail
bash "$(dirname "$0")/../stubs.sh"
git init -q -b main
echo "/.*" >> .git/info/exclude
git config user.name "Ben Drucker"
git config user.email bvdrucker@gmail.com
git config commit.gpgsign false
git remote add origin https://gitlab.example.com/team/service.git

commit() {
  git add -A
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3" git commit -qm "$4"
  git rev-parse HEAD
}

mkdir -p cmd/service internal/ratelimit
cat > go.mod <<'GO'
module gitlab.example.com/team/service

go 1.25
GO
cat > cmd/service/main.go <<'GO'
package main

import (
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	log.Fatal(http.ListenAndServe(":8080", mux))
}
GO
BASE=$(commit "Ben Drucker" bvdrucker@gmail.com "2026-09-01T10:00:00Z" "service: health endpoint")

git switch -qc ratelimit
cat > internal/ratelimit/limiter.go <<'GO'
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is a token bucket per client key.
type Limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
}

func New(rate, burst float64) *Limiter {
	return &Limiter{rate: rate, burst: burst, buckets: map[string]*bucket{}}
}

func (l *Limiter) Allow(key string) bool {
	b, ok := l.buckets[key]
	if !ok {
		l.mu.Lock()
		b = &bucket{tokens: l.burst, last: time.Now()}
		l.buckets[key] = b
		l.mu.Unlock()
	}
	now := time.Now()
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
GO
cat > internal/ratelimit/middleware.go <<'GO'
package ratelimit

import "net/http"

func Middleware(l *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow(r.RemoteAddr) {
			http.Error(w, "rate limited", http.StatusInternalServerError)
			return
		}
		next.ServeHTTP(w, r)
	})
}
GO
V1=$(commit "Priya Nair" priya@team.example.com "2026-09-08T14:00:00Z" "ratelimit: token bucket per client")

cat > internal/ratelimit/limiter_test.go <<'GO'
package ratelimit

import "testing"

func TestAllowUpToBurst(t *testing.T) {
	l := New(1, 3)
	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("request %d rejected inside the burst", i)
		}
	}
	if l.Allow("a") {
		t.Fatal("request past the burst allowed")
	}
}
GO
cat > cmd/service/main.go <<'GO'
package main

import (
	"log"
	"net/http"

	"gitlab.example.com/team/service/internal/ratelimit"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	limiter := ratelimit.New(10, 20)
	log.Fatal(http.ListenAndServe(":8080", ratelimit.Middleware(limiter, mux)))
}
GO
V2=$(commit "Priya Nair" priya@team.example.com "2026-09-09T11:00:00Z" "ratelimit: wire into the server, add a burst test")

cat > internal/ratelimit/limiter.go <<'GO'
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is a token bucket per client key.
type Limiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	buckets map[string]*bucket
}

// New starts a janitor that evicts buckets idle for longer than idle.
func New(rate, burst float64, idle time.Duration) *Limiter {
	l := &Limiter{rate: rate, burst: burst, buckets: map[string]*bucket{}}
	go l.janitor(idle)
	return l
}

func (l *Limiter) janitor(idle time.Duration) {
	for range time.Tick(idle) {
		for key, b := range l.buckets {
			if time.Since(b.last) > idle {
				delete(l.buckets, key)
			}
		}
	}
}

func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: time.Now()}
		l.buckets[key] = b
	}
	l.mu.Unlock()
	now := time.Now()
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// RetryAfter is how long a rejected client waits for one token.
func (l *Limiter) RetryAfter() time.Duration {
	return time.Duration(float64(time.Second) / l.rate)
}
GO
cat > internal/ratelimit/middleware.go <<'GO'
package ratelimit

import (
	"math"
	"net/http"
	"strconv"
)

func Middleware(l *Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow(r.RemoteAddr) {
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(l.RetryAfter().Seconds()))))
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
GO
cat > cmd/service/main.go <<'GO'
package main

import (
	"log"
	"net/http"
	"time"

	"gitlab.example.com/team/service/internal/ratelimit"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	limiter := ratelimit.New(10, 20, 10*time.Minute)
	log.Fatal(http.ListenAndServe(":8080", ratelimit.Middleware(limiter, mux)))
}
GO
cat > internal/ratelimit/limiter_test.go <<'GO'
package ratelimit

import (
	"testing"
	"time"
)

func TestAllowUpToBurst(t *testing.T) {
	l := New(1, 3, time.Minute)
	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("request %d rejected inside the burst", i)
		}
	}
	if l.Allow("a") {
		t.Fatal("request past the burst allowed")
	}
}
GO
V3=$(commit "Priya Nair" priya@team.example.com "2026-09-11T16:00:00Z" "ratelimit: evict idle buckets, lock the map, answer 429")

# The reviewer's checkout sits on main. The MR branch exists only as a remote ref.
git update-ref refs/remotes/origin/main "$BASE"
git update-ref refs/remotes/origin/ratelimit "$V3"
git switch -q main
git branch -q -D ratelimit

jq -n --arg root "$PWD" --arg base "$BASE" --arg v1 "$V1" --arg v2 "$V2" --arg v3 "$V3" -f /dev/stdin > "$HOME/.review-snapshot/meta.json" <<'JQ'
def user($u): {bdrucker: {id: 7, username: "bdrucker", name: "Ben Drucker"}, "priya-n": {id: 31, username: "priya-n", name: "Priya Nair"}, "sam-o": {id: 44, username: "sam-o", name: "Sam Okafor"}}[$u];
def pos($path; $line): {base_sha: $base, start_sha: $base, head_sha: $v2, old_path: $path, new_path: $path, position_type: "text", old_line: null, new_line: $line};
def note($id; $u; $at; $body): {id: $id, type: "DiscussionNote", body: $body, author: user($u), created_at: $at, updated_at: $at, system: false, noteable_id: 89089, noteable_type: "MergeRequest", noteable_iid: 89, resolvable: false};
def sysnote($id; $at; $body): note($id; "priya-n"; $at; $body) + {type: null, system: true};
def thread($id; $resolved; $notes): {id: $id, individual_note: false, notes: ($notes | map(. + {resolvable: true, resolved: $resolved}))};
def diffnote($id; $u; $at; $path; $line; $body): note($id; $u; $at; $body) + {type: "DiffNote", position: pos($path; $line)};
def changed($id; $at): sysnote($id; $at; "changed this line in [version 3 of the diff](/team/service/-/merge_requests/89/diffs?diff_id=303&start_sha=\($v2)#note_\($id))");
{
  root: $root,
  host: "gitlab.example.com",
  project: "team/service",
  projectId: 1207,
  viewer: user("bdrucker"),
  mr: {
    iid: 89,
    title: "Rate limit requests per client",
    description: "Adds a token bucket limiter in front of every route.\n\n- [x] Unit tests\n- [x] Load tested in staging",
    author: {username: "priya-n", name: "Priya Nair"},
    source_branch: "ratelimit",
    created_at: "2026-09-08T14:05:00Z",
    updated_at: "2026-09-11T16:30:00Z"
  },
  versions: [
    {id: 301, head: $v1, base: $base, start: $base, created_at: "2026-09-08T14:05:00Z"},
    {id: 302, head: $v2, base: $base, start: $base, created_at: "2026-09-09T11:02:00Z"},
    {id: 303, head: $v3, base: $base, start: $base, created_at: "2026-09-11T16:02:00Z"}
  ],
  discussions: [
    {id: "d0a1", individual_note: true, notes: [sysnote(5001; "2026-09-09T11:02:00Z"; "added 1 commit\n\n* \($v2[0:8]) - ratelimit: wire into the server, add a burst test")]},
    thread("d1e1"; true; [
      diffnote(5101; "bdrucker"; "2026-09-10T09:12:00Z"; "internal/ratelimit/limiter.go"; 18; "`buckets` gets one entry per client forever. Behind a public endpoint that is unbounded memory. Evict idle buckets."),
      note(5102; "priya-n"; "2026-09-11T16:05:00Z"; "Added eviction with a background janitor.")
    ]),
    thread("d2e2"; true; [
      diffnote(5201; "bdrucker"; "2026-09-10T09:15:00Z"; "internal/ratelimit/limiter.go"; 26; "`Allow` reads and writes the bucket without holding `mu`, so two requests for the same key race on `tokens`. Hold the lock for the whole refill-and-take."),
      changed(5202; "2026-09-11T16:02:00Z")
    ]),
    thread("d3e3"; false; [
      diffnote(5301; "bdrucker"; "2026-09-10T09:18:00Z"; "internal/ratelimit/middleware.go"; 8; "A rejected request should be a 429 with `Retry-After`, not a 500. Clients and our alerts treat 500 as an outage."),
      changed(5302; "2026-09-11T16:02:00Z")
    ]),
    thread("d4e4"; false; [
      diffnote(5401; "bdrucker"; "2026-09-10T09:20:00Z"; "internal/ratelimit/middleware.go"; 7; "`r.RemoteAddr` includes the source port, so each new connection gets a fresh bucket and the limit never bites. Key on the host part.")
    ]),
    thread("d5e5"; true; [
      diffnote(5501; "sam-o"; "2026-09-10T13:00:00Z"; "internal/ratelimit/limiter_test.go"; 5; "Worth a test that tokens refill over time too."),
      note(5502; "priya-n"; "2026-09-11T16:06:00Z"; "Will add with the janitor tests.")
    ]),
    {id: "d6a6", individual_note: true, notes: [sysnote(5601; "2026-09-11T16:02:00Z"; "added 1 commit\n\n* \($v3[0:8]) - ratelimit: evict idle buckets, lock the map, answer 429")]},
    {id: "d7a7", individual_note: true, notes: [note(5701; "priya-n"; "2026-09-11T16:10:00Z"; "Addressed the review. Load tested at 5k rps against staging, p99 unchanged. Ready for another look @bdrucker")]}
  ]
}
JQ
