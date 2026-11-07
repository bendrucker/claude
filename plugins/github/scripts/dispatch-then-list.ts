#!/usr/bin/env bun

// Concurrent sessions append to one metrics file, which needs O_APPEND atomicity that Bun.write lacks.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { invokesRunList, invokesWorkflowRun } from "./gh-invocations";

// A dependency that fails to load lets the gated call through, so this hook imports only node builtins.

const HOOK = "github-dispatch-then-list";
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);

export const REASON =
  "`gh workflow run` prints the new run URL. Dispatch alone, read the run id from its output, then pass it to `gh run view` or `gh run watch`. Listing by workflow picks the wrong run when dispatches overlap.";

interface CommandInput {
  command: string;
}

function hasCommand(toolInput: unknown): toolInput is CommandInput {
  if (toolInput == null || typeof toolInput !== "object" || !("command" in toolInput)) return false;
  return typeof toolInput.command === "string";
}

function field(value: unknown, key: string): string | null {
  if (value == null || typeof value !== "object") return null;
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" ? found : null;
}

export function decide(input: unknown): SyncHookJSONOutput | null {
  const toolInput: unknown =
    input != null && typeof input === "object" ? Reflect.get(input, "tool_input") : null;
  if (!hasCommand(toolInput)) return null;
  if (!invokesWorkflowRun(toolInput.command) || !invokesRunList(toolInput.command)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: REASON,
    },
  };
}

// Same semantics and record shape as `hook-metrics.ts`, which imports zod.
export function metricsPath(
  env: string | undefined = process.env.CLAUDE_HOOK_METRICS,
): string | null {
  if (env !== undefined && OFF_VALUES.has(env.toLowerCase())) return null;
  const dir =
    env != null && env !== "" && !ON_VALUES.has(env.toLowerCase())
      ? env
      : join(homedir(), ".claude", "hook-metrics");
  return join(dir, `${HOOK}.jsonl`);
}

function record(input: unknown, denied: boolean, started: number, path: string | null): void {
  if (path === null) return;
  const metric = {
    ts: new Date().toISOString(),
    session_id: field(input, "session_id") ?? "",
    hook_event: field(input, "hook_event_name") ?? "",
    tool: field(input, "tool_name"),
    duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
    outcome: denied ? "deny" : "silent",
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(metric)}\n`);
  } catch {
    // Metrics must never break the hook they measure.
  }
}

async function main(): Promise<void> {
  const started = performance.now();
  const input: unknown = JSON.parse(await Bun.stdin.text());
  const output = decide(input);
  record(input, output !== null, started, metricsPath());
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      `[github/dispatch-then-list] ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
