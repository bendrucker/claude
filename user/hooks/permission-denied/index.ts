#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The SDK version pinned here predates the PermissionDenied event, so its
// input shape is declared locally.
export type PermissionDeniedInput = {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  reason?: string;
};

export type DenialRecord = {
  timestamp: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  target: string;
  reason: string;
};

const TARGET_FIELDS = ["command", "file_path", "url", "path", "notebook_path", "prompt"];

export function target(toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return "";
  for (const field of TARGET_FIELDS) {
    const value = toolInput[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return JSON.stringify(toolInput);
}

export function record(input: PermissionDeniedInput, timestamp: string): DenialRecord {
  return {
    timestamp,
    session_id: input.session_id ?? "",
    cwd: input.cwd ?? "",
    tool_name: input.tool_name ?? "",
    target: target(input.tool_input),
    reason: input.reason ?? "",
  };
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

// Bun exposes no append primitive, and read-modify-write would drop records
// when concurrent sessions are denied at the same moment.
export function filename(input: PermissionDeniedInput, timestamp: string): string {
  return `${slug(timestamp)}-${slug(input.tool_use_id || "unknown")}.json`;
}

export function logDir(): string {
  return process.env.CLAUDE_AUTO_MODE_DENIAL_DIR ?? join(homedir(), ".claude", "auto-mode-denials");
}

export async function write(dir: string, input: PermissionDeniedInput, timestamp: string) {
  mkdirSync(dir, { recursive: true });
  await Bun.write(
    join(dir, filename(input, timestamp)),
    `${JSON.stringify(record(input, timestamp))}\n`,
  );
}

if (import.meta.main) {
  try {
    const input: PermissionDeniedInput = JSON.parse(await Bun.stdin.text());
    await write(logDir(), input, new Date().toISOString());
  } catch {
    // The denial already happened and this hook's exit code is ignored, so a
    // logging failure must not surface as noise in the session.
  }
}
