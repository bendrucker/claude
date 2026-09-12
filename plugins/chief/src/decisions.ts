// Decision appends need O_APPEND atomicity across concurrent writers; Bun.write's
// read-modify-write would drop concurrent lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DECISIONS_PATH = join(homedir(), ".local", "state", "chief", "decisions.jsonl");

export interface Decision {
  ts: string;
  id: string;
  note: string;
  by: string;
}

export function append(decision: Decision, path: string = DECISIONS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(decision)}\n`);
}

export async function wasDecided(id: string, path: string = DECISIONS_PATH): Promise<boolean> {
  const file = Bun.file(path);
  if (!(await file.exists())) return false;

  for (const line of (await file.text()).split("\n")) {
    if (line.trim() === "") continue;
    try {
      if ((JSON.parse(line) as Decision).id === id) return true;
    } catch {
      continue;
    }
  }
  return false;
}
