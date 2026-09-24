Small CLI, JSON-file store — tags fit as a `string[]` on `Note`, parsed from repeated `--tag` flags.

**Type change**

```diff
 export interface Note {
   id: number;
   text: string;
   createdAt: string;
+  tags: string[];
 }
```

**File tree**

```diff
 src/
 ├── cli.ts
 ├── commands/
 │   ├── add.ts
 │   ├── list.ts
+│   └── tags.ts        # new: `notes tags` — count per tag
 └── store/
     └── notes.ts
```

**cli.ts — route the new command, split flags from positional args**

```diff
 import { add } from "./commands/add";
 import { list } from "./commands/list";
+import { tags } from "./commands/tags";
+import { parseArgs } from "./args";
 
-const [cmd, ...args] = process.argv.slice(2);
-if (cmd === "add") await add(args.join(" "));
-else await list();
+const [cmd, ...rest] = process.argv.slice(2);
+const { text, flags } = parseArgs(rest); // strips --tag values out of rest
+if (cmd === "add") await add(text, flags.tag);
+else if (cmd === "tags") await tags();
+else await list(flags.tag?.[0]);
```

`parseArgs` is the one new seam — everything else is a thin consumer of it:

```ts fragment
interface ParsedArgs {
  text: string;        // remaining words joined back together
  flags: { tag: string[] };
}
function parseArgs(argv: string[]): ParsedArgs
```

**add.ts — accept tags**

```diff
-export async function add(text: string) {
+export async function add(text: string, tags: string[] = []) {
   const notes = await loadNotes();
-  notes.push({ id: notes.length + 1, text, createdAt: new Date().toISOString() });
+  notes.push({ id: notes.length + 1, text, createdAt: new Date().toISOString(), tags });
   await saveNotes(notes);
 }
```

**list.ts — optional tag filter**

```diff
-export async function list() {
-  for (const n of await loadNotes()) console.log(`${n.id}. ${n.text}`);
+export async function list(tag?: string) {
+  const notes = await loadNotes();
+  for (const n of notes)
+    if (!tag || n.tags.includes(tag)) console.log(`${n.id}. ${n.text}  ${n.tags.join(",")}`);
 }
```

**tags.ts — new command**

```ts
import { loadNotes } from "../store/notes";

export async function tags() {
  const counts = new Map<string, number>();
  for (const n of await loadNotes())
    for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [tag, count] of [...counts].sort((a, b) => b[1] - a[1]))
    console.log(`${tag}  ${count}`);
}
```

Usage: `notes add "buy milk" --tag errand --tag home`, `notes list --tag errand`, `notes tags`. Existing notes without a `tags` array just filter/count as empty — no migration needed since `loadNotes` reads whatever JSON is on disk.
