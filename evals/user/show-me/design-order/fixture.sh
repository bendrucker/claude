#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/commands src/store
cat > src/cli.ts <<'TS'
import { add } from "./commands/add";
import { list } from "./commands/list";

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "add") await add(args.join(" "));
else await list();
TS
cat > src/commands/add.ts <<'TS'
import { loadNotes, saveNotes } from "../store/notes";

export async function add(text: string) {
  const notes = await loadNotes();
  notes.push({ id: notes.length + 1, text, createdAt: new Date().toISOString() });
  await saveNotes(notes);
}
TS
cat > src/commands/list.ts <<'TS'
import { loadNotes } from "../store/notes";

export async function list() {
  for (const n of await loadNotes()) console.log(`${n.id}. ${n.text}`);
}
TS
cat > src/store/notes.ts <<'TS'
export interface Note {
  id: number;
  text: string;
  createdAt: string;
}

const PATH = `${process.env.HOME}/.notes.json`;

export async function loadNotes(): Promise<Note[]> {
  const file = Bun.file(PATH);
  return (await file.exists()) ? file.json() : [];
}

export async function saveNotes(notes: Note[]) {
  await Bun.write(PATH, JSON.stringify(notes, null, 2));
}
TS
