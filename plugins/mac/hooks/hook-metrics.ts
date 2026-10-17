// concurrent sessions append to one file per hook, so writes need O_APPEND atomicity and rotation needs rename. A Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Writes the same `~/.claude/hook-metrics/<hook>.jsonl` records as
// `user/scripts/hook-metrics.ts`, which the observability `hook-self-timing`
// query reads. A cached plugin cannot import that file, so this carries the
// subset a hook that never gates a call needs.
export type HookOutcome = "silent" | "output" | "error";

export interface HookMetric {
  ts: string;
  session_id: string;
  hook_event: string;
  tool: string | null;
  duration_ms: number;
  outcome: HookOutcome;
}

export interface HookMetricInput {
  session_id?: unknown;
  hook_event_name?: unknown;
  tool_name?: unknown;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g;

/** Unset is on, 0/false/off disables, and any other value is a destination directory. */
export function resolveMetricsPath(
  hook: string,
  env: string | undefined = process.env.CLAUDE_HOOK_METRICS,
): string | null {
  if (env !== undefined && OFF_VALUES.has(env.toLowerCase())) return null;
  const dir =
    env != null && env !== "" && !ON_VALUES.has(env.toLowerCase())
      ? env
      : join(homedir(), ".claude", "hook-metrics");
  return join(dir, `${hook.replace(UNSAFE_NAME, "-")}.jsonl`);
}

function appendHookMetric(hook: string, metric: HookMetric, path: string | null): void {
  if (path == null || path === "") return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (Bun.file(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`);
    }
    appendFileSync(path, `${JSON.stringify(metric)}\n`);
  } catch {
    // Metrics must never break the hook they measure.
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Times `run` and records one line per invocation. A throw is recorded as `error` and re-thrown. */
export async function timeHook<T>(
  hook: string,
  input: HookMetricInput,
  run: () => T | Promise<T>,
  path: string | null = resolveMetricsPath(hook),
): Promise<T> {
  const started = performance.now();
  const record = (outcome: HookOutcome) => {
    appendHookMetric(
      hook,
      {
        ts: new Date().toISOString(),
        session_id: text(input.session_id) ?? "",
        hook_event: text(input.hook_event_name) ?? "",
        tool: text(input.tool_name),
        duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
        outcome,
      },
      path,
    );
  };

  try {
    const output = await run();
    record(output == null ? "silent" : "output");
    return output;
  } catch (error) {
    record("error");
    throw error;
  }
}
