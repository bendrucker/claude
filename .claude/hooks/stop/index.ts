#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decodeJson, decodeStdin } from "../../../packages/decode/index";

const execFileAsync = promisify(execFile);
const PREK_TIMEOUT = 120_000;

const ContentBlock = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  input: z.looseObject({ file_path: z.string().optional() }).optional(),
});

const TranscriptEntry = z.looseObject({
  type: z.string().optional(),
  message: z
    .looseObject({ content: z.union([z.string(), z.array(ContentBlock)]).optional() })
    .optional(),
});

export const StopInput = z.looseObject({
  hook_event_name: z.literal("Stop"),
  cwd: z.string(),
  transcript_path: z.string(),
  stop_hook_active: z.boolean().optional(),
});

type StopInput = z.infer<typeof StopInput>;

const PrekFailure = z.looseObject({
  code: z.string().optional(),
  killed: z.boolean().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  message: z.string().optional(),
});

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

export async function parseTranscript(transcriptPath: string): Promise<string[]> {
  if (!(await fileExists(transcriptPath))) {
    return [];
  }

  const content = await Bun.file(transcriptPath).text();
  const existChecks: Array<Promise<{ path: string; exists: boolean }>> = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = decodeJson(TranscriptEntry, line, transcriptPath);
      const blocks = entry.message?.content;
      if (entry.type !== "assistant" || !Array.isArray(blocks)) continue;

      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write") continue;

        const filePath = block.input?.file_path;
        if (filePath) {
          existChecks.push(fileExists(filePath).then((exists) => ({ path: filePath, exists })));
        }
      }
    } catch {}
  }

  const results = await Promise.all(existChecks);
  const files = new Set<string>();
  for (const { path, exists } of results) {
    if (exists) {
      files.add(path);
    }
  }

  return [...files];
}

export function scopePaths(files: string[], cwd: string): string[] {
  const scoped: string[] = [];
  for (const file of files) {
    const rel = relative(cwd, file);
    if (rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) {
      scoped.push(rel);
    }
  }
  return scoped;
}

export async function processStop(input: StopInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  if (process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE) {
    return null;
  }

  const files = await parseTranscript(input.transcript_path);
  if (files.length === 0) {
    return null;
  }

  const relativePaths = scopePaths(files, input.cwd);
  if (relativePaths.length === 0) {
    return null;
  }

  try {
    await execFileAsync("bun", ["install", "--cwd", input.cwd]);
    await execFileAsync("prek", ["run", "--files", ...relativePaths], {
      cwd: input.cwd,
      timeout: PREK_TIMEOUT,
    });
    return null;
  } catch (error) {
    const failure = PrekFailure.safeParse(error);
    const execError = failure.success ? failure.data : {};
    const output = ((execError.stdout || "") + (execError.stderr || "")).trim();

    let context: string;
    if (execError.code === "ENOENT") {
      context = "prek is not installed or not in PATH";
    } else if (execError.killed) {
      context = `Checks timed out after ${PREK_TIMEOUT / 1000}s. Partial output:\n\n${output}`;
    } else {
      context = `Check failures:\n\n${output || execError.message || String(error)}`;
    }

    return {
      decision: "block",
      reason: context,
    };
  }
}

async function main(): Promise<void> {
  let input: StopInput;
  try {
    input = await decodeStdin(StopInput, "stop hook input");
  } catch {
    return;
  }

  const output = await processStop(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
