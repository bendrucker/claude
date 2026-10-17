// concurrent sessions append to one file per hook, so writes need O_APPEND atomicity and rotation needs rename. A Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HookPermissionDecision, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// `hook_events` in the session index records a hook only when it produced visible
// output, which is a few percent of actual fires. A hook that self-times writes
// its own denominator here, and the duration excludes process spawn and
// interpreter start that the harness figure includes.
export const HookOutcome = z.enum([
  "allow",
  "deny",
  "ask",
  "defer",
  "silent",
  "context",
  "block",
  "output",
  "error",
]) satisfies z.ZodType<
  HookPermissionDecision | "silent" | "context" | "block" | "output" | "error"
>;
export type HookOutcome = z.infer<typeof HookOutcome>;

export const HookMetric = z.object({
  ts: z.string(),
  session_id: z.string(),
  hook_event: z.string(),
  tool: z.string().nullable(),
  duration_ms: z.number(),
  outcome: HookOutcome,
});
export type HookMetric = z.infer<typeof HookMetric>;

// Structural subset of every SDK hook input. `tool_name` is absent on the
// non-tool events (UserPromptSubmit, Stop), so it stays optional.
export interface HookMetricInput {
  session_id?: string | undefined;
  hook_event_name?: string | undefined;
  tool_name?: string | undefined;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g;

// CLAUDE_HOOK_METRICS resolves in this one place: unset defaults to on, 0/false/off
// disables, and any other value is a destination directory override. A settings
// `env` entry is enough to turn the whole surface off later.
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

export function classifyOutcome(output: SyncHookJSONOutput | null | undefined): HookOutcome {
  if (!output) return "silent";
  const specific = output.hookSpecificOutput;
  if (specific && "permissionDecision" in specific) {
    return specific.permissionDecision;
  }
  if (output.decision === "block") return "block";
  if (specific && "additionalContext" in specific && specific.additionalContext !== "")
    return "context";
  return "output";
}

export function appendHookMetric(
  hook: string,
  metric: HookMetric,
  path: string | null = resolveMetricsPath(hook),
): void {
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

// Wraps a hook's decision path so the caller stays a single line. A throw from
// `run` is recorded as an error outcome and re-thrown: the hook's own error
// handling decides what happens next.
export async function timeHook<T extends SyncHookJSONOutput | null | undefined>(
  hook: string,
  input: HookMetricInput,
  run: () => T | Promise<T>,
  path?: string | null,
): Promise<T> {
  const started = performance.now();
  const record = (outcome: HookOutcome) => {
    const metric: HookMetric = {
      ts: new Date().toISOString(),
      session_id: input.session_id ?? "",
      hook_event: input.hook_event_name ?? "",
      tool: input.tool_name ?? null,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
      outcome,
    };
    appendHookMetric(hook, metric, path);
  };

  try {
    const output = await run();
    record(classifyOutcome(output));
    return output;
  } catch (error) {
    record("error");
    throw error;
  }
}
