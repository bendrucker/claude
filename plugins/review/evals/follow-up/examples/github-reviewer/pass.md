## Needs Your Attention

- `src/db/pool.ts` (resolved, partial): `query()` now releases in a `finally`, but `withTransaction` still skips `client.release()` after a rollback. No test touches `pool.ts`, so the reply's test claim does not hold.
- New issue: `query()` releases the client twice on success.
- `src/routes/orders.ts:20` (unresolved, dismissed): the N+1 loop is unchanged and deferred to a follow-up PR.

## Cleanly Addressed

Three threads: the `limit` clamp, the restored `user_id` scope, and the `attempts` rename.

## Recommendation

Request changes.
