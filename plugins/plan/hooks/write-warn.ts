#!/usr/bin/env bun

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SIDECAR_GUIDANCE, SIZE_THRESHOLD } from "./gate";

const ToolInput = z.looseObject({ file_path: z.string().optional().catch(undefined) });

const HookInput = z.looseObject({
  hook_event_name: z.literal("PostToolUse"),
  session_id: z.string().catch(""),
  transcript_path: z.string().catch(""),
  cwd: z.string().catch(""),
  tool_name: z.string().catch(""),
  tool_input: z.unknown().catch(undefined),
  tool_response: z.unknown().catch(undefined),
  tool_use_id: z.string().catch(""),
}) satisfies z.ZodType<PostToolUseHookInput>;

const Settings = z.looseObject({ plansDirectory: z.string().optional().catch(undefined) });

async function readPlansDirectorySetting(path: string): Promise<string | undefined> {
  try {
    return Settings.parse(JSON.parse(await Bun.file(path).text())).plansDirectory;
  } catch {
    // No settings file, unreadable, or malformed: fall through to the next source.
    return undefined;
  }
}

// Mirrors the native `plansDirectory` setting: a project path takes precedence
// over a user one, and an unset value falls back to `~/.claude/plans`.
export async function resolvePlansDirectory(cwd: string, home = homedir()): Promise<string> {
  const configured =
    (await readPlansDirectorySetting(join(cwd, ".claude", "settings.json"))) ??
    (await readPlansDirectorySetting(join(home, ".claude", "settings.json")));
  return configured !== undefined ? resolve(cwd, configured) : join(home, ".claude", "plans");
}

export function isPlanFile(filePath: string, plansDirectory: string): boolean {
  return filePath.endsWith(".md") && dirname(filePath) === plansDirectory;
}

function formatWarning(chars: number): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `This plan file is ${chars.toLocaleString()} characters, over the ` +
        `${SIZE_THRESHOLD.toLocaleString()}-character presentation limit. ${SIDECAR_GUIDANCE}`,
    },
  };
}

export async function processInput(
  input: PostToolUseHookInput,
  home = homedir(),
): Promise<SyncHookJSONOutput | null> {
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") return null;

  const filePath = ToolInput.safeParse(input.tool_input).data?.file_path;
  if (filePath === undefined) return null;
  if (!isPlanFile(filePath, await resolvePlansDirectory(input.cwd, home))) return null;

  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    // A file the tool just wrote should always be readable. A race or permission
    // issue here must not fail the hook: skip the warning rather than the write.
    return null;
  }

  return content.length > SIZE_THRESHOLD ? formatWarning(content.length) : null;
}

async function main(): Promise<void> {
  let input: PostToolUseHookInput;
  try {
    input = HookInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.error(
      `[plan/write-warn] undecodable stdin: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  await main();
}
