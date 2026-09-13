// Decision appends need O_APPEND atomicity across concurrent writers; Bun.write's
// read-modify-write would drop concurrent lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const DECISIONS_PATH = join(homedir(), ".local", "state", "chief", "decisions.jsonl");

const Decision = z.object({
  ts: z.string(),
  id: z.string(),
  note: z.string(),
  by: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export function append(decision: Decision, path: string = DECISIONS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(decision)}\n`);
}

export async function wasDecided(id: string, path: string = DECISIONS_PATH): Promise<boolean> {
  const file = Bun.file(path);
  if (!(await file.exists())) return false;

  for (const line of (await file.text()).split("\n")) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = Decision.safeParse(json);
    if (parsed.success && parsed.data.id === id) return true;
  }
  return false;
}
