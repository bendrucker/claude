---
fail: [diff-block, short-close]
---
No other callers reference it yet, so I'll just work from `save.ts` and `watchers.ts` directly.

Here's the shape of the change — no edits made yet:

```ts
import { writeFile } from "node:fs/promises";
import { notifyWatchers } from "./watchers";

const lastSaved = new Map<string, string>();

export async function save(path: string, content: string) {
  if (lastSaved.get(path) === content) {
    return null; // unchanged, nothing written, no watchers notified
  }

  await writeFile(path, content);
  lastSaved.set(path, content);

  const result = { path, bytes: content.length, savedAt: Date.now() };
  notifyWatchers(result);
  return result;
}
```

Key points:

- **`lastSaved` cache**: a module-level `Map<path, content>` tracks what was last written per path. Cheap `===` string comparison, no extra disk read.
- **Early return on match**: skips both `writeFile` and `notifyWatchers` — the two costs you flagged.
- **Return type becomes nullable**: callers need to handle `save()` returning `null` when it no-ops. If callers currently assume a `result` object always comes back (e.g. to log `bytes`/`savedAt`), that's a breaking change worth checking before landing this.
- **Cache correctness caveat**: since the cache is in-memory, it won't know about content written to `path` by anything other than this `save()` function (e.g. another process, or the file being edited externally). If that matters, the alternative is comparing against `readFile(path)` instead of the in-memory cache — costs an extra read but stays correct even if the file changes out-of-band. Given this looks like a single-process autosave, the in-memory Map is simpler and almost certainly fine.

Want me to apply this, and if so, should `save()` return `null` on no-op or should it return the previous result unchanged?
