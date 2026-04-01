#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";

const execFileAsync = promisify(execFile);
const PREK_TIMEOUT = 120_000;

interface TranscriptEntry {
  type?: string;
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: { file_path?: string };
    }>;
  };
}

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
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.type !== "assistant" || !entry.message?.content) continue;

      for (const block of entry.message.content) {
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

export async function processStop(input: StopHookInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  const files = await parseTranscript(input.transcript_path);
  if (files.length === 0) {
    return null;
  }

  const relativePaths = files.map((f) => relative(input.cwd, f));

  try {
    await execFileAsync("prek", ["run", "--files", ...relativePaths], {
      cwd: input.cwd,
      timeout: PREK_TIMEOUT,
    });
    return null;
  } catch (error) {
    const execError = error as {
      code?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    const output = ((execError.stdout || "") + (execError.stderr || "")).trim();

    let context: string;
    if (execError.code === "ENOENT") {
      context = "prek is not installed or not in PATH";
    } else if (execError.killed) {
      context = `Checks timed out after ${PREK_TIMEOUT / 1000}s. Partial output:\n\n${output}`;
    } else {
      context = `Check failures:\n\n${output || (error as Error).message}`;
    }

    return {
      decision: "block",
      reason: context,
    };
  }
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = await readStdinJson<StopHookInput>();
  } catch {
    return;
  }

  if (input.hook_event_name !== "Stop") return;

  const output = await processStop(input);
  if (output) {
    writeStdoutJson(output);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
