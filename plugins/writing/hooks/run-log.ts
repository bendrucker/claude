// concurrent sessions append to one log, so writes need O_APPEND atomicity and rotation needs rename. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const RunOutcome = z.enum(["silent", "context", "ask", "deny", "skipped-scratch"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

const LEGACY_KEYS: Record<string, string> = {
  category: "check",
  categories: "checks",
  suppressed_categories: "suppressed_checks",
};

const RunLogFields = z.object({
  ts: z.string(),
  session_id: z.string(),
  tool: z.string(),
  ext: z.string(),
  duration_ms: z.number(),
  outcome: RunOutcome,
  check: z.string().optional(),
  suppressed: z.boolean().optional(),
  // Hashed file path, so repeated writes to one file correlate without the
  // path itself landing in a log a report may quote.
  target: z.string().optional(),
  // Every Vale check that alerted this run, not only the one reported.
  // Absent when the run returned before the checkers ran.
  checks: z.array(z.string()).optional(),
  // Every check the run injected, and every one repeat suppression muted.
  // Older entries carry only `check` and `suppressed`.
  emitted: z.array(z.string()).optional(),
  suppressed_checks: z.array(z.string()).optional(),
});
// Entries written before the Vale port name checks under the `category` keys.
export const RunLogEntry = z
  .record(z.string(), z.unknown())
  .transform((fields) =>
    Object.fromEntries(Object.entries(fields).map(([key, v]) => [LEGACY_KEYS[key] ?? key, v])),
  )
  .pipe(RunLogFields);
export type RunLogEntry = z.infer<typeof RunLogFields>;

const INJECTION_OUTCOMES = new Set<RunOutcome>(["context", "ask", "deny"]);

export function emittedOf(entry: RunLogEntry): string[] {
  if (entry.emitted) return entry.emitted;
  if (entry.check == null || entry.check === "" || entry.suppressed === true) return [];
  return INJECTION_OUTCOMES.has(entry.outcome) ? [entry.check] : [];
}

export function suppressedOf(entry: RunLogEntry): string[] {
  if (entry.suppressed_checks) return entry.suppressed_checks;
  return entry.suppressed === true && entry.check != null && entry.check !== ""
    ? [entry.check]
    : [];
}

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
  if (env != null && env !== "" && !ON_VALUES.has(env.toLowerCase())) return env;
  return join(homedir(), ".claude", "writing-hooks", "log.jsonl");
}

export function appendRunLog(entry: RunLogEntry, path: string | null = resolveLogPath()): void {
  if (path == null || path === "") return;
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
