#!/usr/bin/env bun

// concurrent sessions append to one log, so writes need O_APPEND atomicity and rotation needs rename. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { decodeStdin } from "../../../packages/decode/index";
import { HookInput } from "../../scripts/hook-input";

export const DenialRecord = z.object({
  ts: z.string(),
  session_id: z.string(),
  cwd: z.string(),
  tool: z.string(),
  target: z.string(),
  reason: z.string(),
});
export type DenialRecord = z.infer<typeof DenialRecord>;

const DeniedInput = HookInput.extend({
  cwd: z.string().catch(""),
  reason: z.string().catch(""),
});
export type DeniedInput = z.infer<typeof DeniedInput>;

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const OFF_VALUES = new Set(["0", "false", "off"]);
const ON_VALUES = new Set(["1", "true", "on"]);

// The first non-empty field identifies what was denied, in this precedence.
const Target = z.looseObject({
  command: z.string().optional().catch(undefined),
  file_path: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
  path: z.string().optional().catch(undefined),
  notebook_path: z.string().optional().catch(undefined),
  prompt: z.string().optional().catch(undefined),
});

export function target(toolInput: unknown): string {
  const fields = Target.safeParse(toolInput).data;
  if (!fields) return "";
  for (const value of [
    fields.command,
    fields.file_path,
    fields.url,
    fields.path,
    fields.notebook_path,
    fields.prompt,
  ]) {
    if (value) return value;
  }
  return JSON.stringify(toolInput);
}

export function record(input: Partial<DeniedInput>, ts: string): DenialRecord {
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
    append(
      record(await decodeStdin(DeniedInput, "permission-denied stdin"), new Date().toISOString()),
    );
  } catch (error) {
    // The exit code is ignored on this event, so a logging failure cannot break
    // the session. It still has to be visible: an empty log is the signal that
    // retires this hook, and a silent failure forges that signal.
    console.error(
      `[permission-denied] Failed to log denial: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
