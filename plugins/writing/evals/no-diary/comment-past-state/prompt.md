no-diary this comment.

```ts
// Callers must hold cacheLock. We added the lock after the March deadlock
// (INC-221), when two workers refreshed the same entry at once. Priya suggested
// in review that we serialize here rather than in each caller, which was the old
// approach and kept getting missed. Acme's nightly import was the worst hit.
function refresh(cache: Cache, key: string) {
  const entry = cache.load(key);
  cache.store(key, rebuild(entry));
}
```
