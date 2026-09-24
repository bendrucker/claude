---
fail: []
---
<rewrite>
// Callers must hold cacheLock to prevent concurrent refreshes of the same entry.
function refresh(cache: Cache, key: string) {
  const entry = cache.load(key);
  cache.store(key, rebuild(entry));
}
</rewrite>

Cut the incident number, the reviewer name, the customer name, and the narrative about the old per-caller locking approach — none of that helps a future reader use the function correctly. Kept the one fact that matters: the invariant and why it exists.
