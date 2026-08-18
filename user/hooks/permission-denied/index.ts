#!/usr/bin/env bun

// concurrent sessions append to one log, so writes need O_APPEND atomicity and rotation needs rename. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PermissionDeniedHookInput } from "@anthropic-ai/claude-agent-sdk";

export type DenialRecord = {
  ts: string;
  session_id: string;
  cwd: string;
  tool: string;
  target: string;
  reason: string;
};

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);
const TARGET_FIELDS = ["command", "file_path", "url", "path", "notebook_path", "prompt"];

export function target(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") return "";
  const fields = toolInput as Record<string, unknown>;
  for (const field of TARGET_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return JSON.stringify(toolInput);
}

export function record(input: Partial<PermissionDeniedHookInput>, ts: string): DenialRecord {
  return {
    ts,
    session_id: input.session_id ?? "",
    cwd: input.cwd ?? "",
    tool: input.tool_name ?? "",
    target: target(input.tool_input),
    reason: input.reason ?? "",
  };
}

// CLAUDE_AUTO_MODE_DENIAL_LOG resolves in this one place: unset defaults to on
// (current phase: collecting evidence), 0/false/off disables, and any other
// value is a destination path override.
export function resolveLogPath(
  env: string | undefined = process.env.CLAUDE_AUTO_MODE_DENIAL_LOG,
): string | null {
  if (env !== undefined && OFF_VALUES.has(env.toLowerCase())) return null;
  if (env && !ON_VALUES.has(env.toLowerCase())) return env;
  return join(homedir(), ".claude", "auto-mode-denials.jsonl");
}

export function append(entry: DenialRecord, path: string | null = resolveLogPath()): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  if (Bun.file(path).size > MAX_LOG_BYTES) {
    renameSync(path, `${path}.1`);
  }
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

if (import.meta.main) {
  try {
    const input: Partial<PermissionDeniedHookInput> = JSON.parse(await Bun.stdin.text());
    append(record(input, new Date().toISOString()));
  } catch (error) {
    // The exit code is ignored on this event, so a logging failure cannot break
    // the session. It still has to be visible: an empty log is the signal that
    // retires this hook, and a silent failure forges that signal.
    console.error(`[permission-denied] Failed to log denial: ${error}`);
  }
}
