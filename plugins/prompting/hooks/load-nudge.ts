#!/usr/bin/env bun

import { join } from "node:path";

// The <session_id> "loaded" marker is written by the bang-execution line in
// skills/prompting/SKILL.md. Keep the path in sync with that command.
export const MARKER_DIR = "/tmp/claude/prompting-skill";

export const NUDGE =
  "This edit changes a document a model executes. Load the prompting:prompting skill before the next edit to it: it holds the rules for placement, pointers, completion criteria, and sentence form.";

export interface NudgeEnv {
  fileExists(path: string): Promise<boolean>;
  touch(path: string): Promise<void>;
}

export const defaultEnv: NudgeEnv = {
  fileExists: (path) => Bun.file(path).exists(),
  touch: async (path) => {
    try {
      await Bun.write(path, "");
    } catch {
      // fail open: the nudge just repeats next time
    }
  },
};

interface HookInput {
  session_id: string;
}

interface NudgeOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    additionalContext: string;
  };
}

function isHookInput(value: unknown): value is HookInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "session_id" in value &&
    typeof value.session_id === "string" &&
    value.session_id !== ""
  );
}

export function parseInput(text: string): HookInput | null {
  try {
    const value: unknown = JSON.parse(text);
    return isHookInput(value) ? value : null;
  } catch {
    // Input that is not JSON carries no session to nudge.
    return null;
  }
}

export async function nudgeOnce(
  sessionId: string,
  env: NudgeEnv = defaultEnv,
): Promise<NudgeOutput | null> {
  if (await env.fileExists(join(MARKER_DIR, sessionId))) return null;
  const nudged = join(MARKER_DIR, `${sessionId}.nudged`);
  if (await env.fileExists(nudged)) return null;
  await env.touch(nudged);
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NUDGE } };
}

async function main(): Promise<void> {
  const input = parseInput(await Bun.stdin.text());
  if (input == null) return;
  const output = await nudgeOnce(input.session_id);
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}
