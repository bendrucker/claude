---
fail: [short-close]
---
Here's the current logic and the change needed.

**Current** (`src/save.ts`) — every call writes the file and notifies, unconditionally:

```ts
export async function save(path: string, content: string) {
  await writeFile(path, content);
  const result = { path, bytes: content.length, savedAt: Date.now() };
  notifyWatchers(result);
  return result;
}
```

**Proposed change** — cache the last-saved content per path in memory, and short-circuit if the new content is identical:

```diff
 import { writeFile } from "node:fs/promises";
 import { notifyWatchers } from "./watchers";
 
+const lastSaved = new Map<string, string>();
+
 export async function save(path: string, content: string) {
+  if (lastSaved.get(path) === content) {
+    return { path, bytes: content.length, savedAt: null, skipped: true };
+  }
+
   await writeFile(path, content);
+  lastSaved.set(path, content);
   const result = { path, bytes: content.length, savedAt: Date.now() };
   notifyWatchers(result);
   return result;
 }
```

Notes on the approach:

- **In-memory cache vs. re-reading the file**: comparing against a `Map<path, content>` avoids an extra disk read on every autosave (cheaper, and correct even if the write is buffered/async). The tradeoff is it only knows about writes made through this module — if the file is edited externally, the cache goes stale until the next actual save.
- **Return shape**: callers currently rely on `savedAt`/`result` from `notifyWatchers`. I added a `skipped: true` result so callers can distinguish "no-op" from "saved" if they care, but that's a shape change worth confirming — if nothing consumes the return value that way, we could just return the last real result instead, or `undefined`.
- **Memory growth**: `lastSaved` grows one entry per distinct path saved and never evicts. Fine if the set of paths is small/bounded (e.g. open files in an editor); worth a cap or WeakMap-style eviction if paths are unbounded/dynamic.
- Didn't reach for a hash (e.g. content digest) since string equality is simpler and content sizes here are presumably editor-buffer-sized; would revisit if `content` can be very large.

Want me to apply this, or adjust the cache/eviction/return-value tradeoffs first?
