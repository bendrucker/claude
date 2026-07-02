#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { StopHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson, writeStdoutJson } from "@constellos/claude-code-kit/runners";
import {
  type BaselineVerifier,
  createVerifier,
  evaluateStop,
  parsePrekOutput,
  readState,
  stateFilePath,
  writeState,
} from "./baseline";

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

export interface PrekOutcome {
  ok: boolean;
  output: string;
  errorKind?: "enoent" | "timeout";
}

async function runPrek(cwd: string, files: string[]): Promise<PrekOutcome> {
  try {
    await execFileAsync("bun", ["install", "--cwd", cwd]);
    const { stdout, stderr } = await execFileAsync("prek", ["run", "--files", ...files], {
      cwd,
      timeout: PREK_TIMEOUT,
    });
    return { ok: true, output: stdout + stderr };
  } catch (error) {
    const execError = error as {
      code?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    const output = ((execError.stdout || "") + (execError.stderr || "")).trim();

    if (execError.code === "ENOENT") return { ok: false, output, errorKind: "enoent" };
    if (execError.killed) return { ok: false, output, errorKind: "timeout" };
    return { ok: false, output: output || (error as Error).message };
  }
}

export interface StopDeps {
  runPrek?: typeof runPrek;
  verify?: BaselineVerifier;
  statePath?: string;
}

export async function processStop(
  input: StopHookInput,
  deps: StopDeps = {},
): Promise<SyncHookJSONOutput | null> {
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

  const outcome = await (deps.runPrek ?? runPrek)(input.cwd, relativePaths);

  if (outcome.errorKind === "enoent") {
    return { decision: "block", reason: "prek is not installed or not in PATH" };
  }
  if (outcome.errorKind === "timeout") {
    return {
      decision: "block",
      reason: `Checks timed out after ${PREK_TIMEOUT / 1000}s. Partial output:\n\n${outcome.output}`,
    };
  }

  const results = parsePrekOutput(outcome.output);
  if (!outcome.ok && !results.some((result) => result.status === "failed")) {
    return { decision: "block", reason: `Check failures:\n\n${outcome.output}` };
  }

  const statePath = deps.statePath ?? stateFilePath(input.session_id, input.cwd);
  const state = await readState(statePath);
  const before = JSON.stringify(state);
  const verify =
    deps.verify ??
    createVerifier({
      cwd: input.cwd,
      transcriptPath: input.transcript_path,
      files: relativePaths,
    });

  const output = await evaluateStop(state, results, verify);
  if (JSON.stringify(state) !== before) {
    // A failed state write must not discard the decision.
    await writeState(statePath, state).catch(() => {});
  }
  return output;
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
