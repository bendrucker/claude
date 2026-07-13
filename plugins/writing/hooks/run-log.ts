// biome-ignore lint/style/noRestrictedImports: concurrent sessions append to one log, so writes need O_APPEND atomicity and rotation needs rename. Bun.write read-modify-write would drop lines.
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type RunOutcome = "silent" | "context" | "ask" | "deny" | "skipped-scratch";

export type RunLogEntry = {
  ts: string;
  session_id: string;
  tool: string;
  ext: string;
  duration_ms: number;
  outcome: RunOutcome;
  category?: string;
  suppressed?: boolean;
};

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);

// WRITING_HOOKS_LOG resolves in this one place: unset defaults to on (current
// phase: collecting evidence), 0/false/off disables, and any other value is a
// destination path override. A settings `env` entry is enough to turn logging
// off later.
export function resolveLogPath(
  env: string | undefined = process.env.WRITING_HOOKS_LOG,
): string | null {
  if (env !== undefined && OFF_VALUES.has(env.toLowerCase())) return null;
  if (env && !ON_VALUES.has(env.toLowerCase())) return env;
  return join(homedir(), ".claude", "writing-hooks", "log.jsonl");
}

export function appendRunLog(entry: RunLogEntry, path: string | null = resolveLogPath()): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const file = Bun.file(path);
    if (file.size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  } catch {
    // Observability must never break the hook.
  }
}
