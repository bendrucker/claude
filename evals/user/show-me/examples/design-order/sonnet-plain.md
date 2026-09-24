---
fail: [call-tree, file-layout, plan-order, short-close, signatures]
---
Based on the codebase (`src/cli.ts`, `src/commands/add.ts`, `src/commands/list.ts`, `src/store/notes.ts` — a minimal Bun/TypeScript CLI, no framework, notes persisted as a flat JSON array at `~/.notes.json`), here's the design:

**1. Data model** — add `tags: string[]` to `Note` in `store/notes.ts`:
```ts
export interface Note {
  id: number;
  text: string;
  createdAt: string;
  tags: string[];
}
```
Normalize tags to lowercase/trimmed on write, so `Shopping` and `shopping` don't fork into separate tags. `loadNotes()` should default `tags` to `[]` for old entries in `~/.notes.json` that predate this field (no migration script needed — just tolerate absence on read).

**2. Shared flag parsing** — the current `add`/`list` take raw joined strings with no flag support, and I need `--tag`/`-t` in both `add` and `list`. Rather than duplicate parsing, add one small helper, e.g. `src/lib/args.ts`:
```ts
function extractTags(args: string[]): { tags: string[]; rest: string[] }
```
Pulls out repeated `--tag <value>` / `-t <value>` pairs, returns the leftover args untouched. Keeps things framework-free, consistent with the rest of the codebase.

**3. `add` command** — `notes add Buy milk --tag shopping --tag urgent`. `cli.ts` extracts tags before joining the remainder into `text`, so `add.ts` becomes `add(text: string, tags: string[])`.

**4. `list --tag <value>` filter** — `notes list --tag shopping` filters notes where `tags.includes(normalize(value))`. No `--tag` means unfiltered, unchanged behavior.

**5. New `tags` command** — `notes tags`, prints each tag with its count across all notes, sorted by count desc then alpha:
```
shopping (3)
urgent (2)
work (1)
```
Implemented as a new `src/commands/tags.ts`, aggregating over `loadNotes()` — no new storage needed since tags live on the note itself.

**6. `cli.ts` dispatch** — currently a two-branch `if/else` where anything not `"add"` falls through to `list()`. Adding a third command means that fallthrough becomes wrong (a typo'd command would silently list notes). I'd switch to an explicit `switch (cmd)` with a `default:` that prints usage/errors, rather than defaulting to `list`.

**Tradeoff worth flagging**: no tests exist yet for `add`/`list`, so there's nothing to extend for `tags` — I'd add basic tests alongside this feature rather than leave it uncovered, but that's more scope than "just tags." Let me know if you want that included or kept minimal.

Want me to implement this?
