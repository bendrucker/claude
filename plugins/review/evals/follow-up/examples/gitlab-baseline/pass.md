## Needs Your Attention

- `limiter.go:26` (resolved by a system note only, mechanical): `Allow` locks for the map lookup but updates `tokens` after unlocking.
- New issue: the janitor ranges over `buckets` without holding `mu`.
- `middleware.go:7` (open, not addressed): still keyed on `r.RemoteAddr`.
- Unverified: the staging load test at 5k rps.

## Cleanly Addressed

`middleware.go:8`: 429 with `Retry-After`, though the thread is still open.

## Recommendation

Request changes.
