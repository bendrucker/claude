#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decode, decodeJson, decodeStdin } from "../../../packages/decode/index";

// oxlint-disable-next-line typescript/strict-void-return -- tsc resolves promisify(execFile) through Node's [util.promisify.custom] overload correctly; a cast narrow enough to satisfy this rule trips typescript/no-unsafe-type-assertion instead.
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
  session_id: z.string(),
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

const ProcessedState = z.looseObject({ lineCount: z.number().optional() });

async function fileExists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

export interface TranscriptScan {
  files: string[];
  lineCount: number;
}

// `sinceLine` is the transcript length a previous Stop recorded, so a session
// with one early edit and many idle Stops after it scans nothing on each of
// those instead of the whole transcript.
export async function parseTranscript(
  transcriptPath: string,
  sinceLine = 0,
): Promise<TranscriptScan> {
  if (!(await fileExists(transcriptPath))) {
    return { files: [], lineCount: sinceLine };
  }

  const content = await Bun.file(transcriptPath).text();
  const lines = content.split("\n");
  const existChecks: Promise<{ path: string; exists: boolean }>[] = [];

  for (let i = sinceLine; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === "") continue;

    try {
      const entry = decodeJson(TranscriptEntry, line, transcriptPath);
      const blocks = entry.message?.content;
      if (entry.type !== "assistant" || !Array.isArray(blocks)) continue;

      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write" && block.name !== "MultiEdit") continue;

        const filePath = block.input?.file_path;
        if (filePath != null && filePath !== "") {
          existChecks.push(fileExists(filePath).then((exists) => ({ path: filePath, exists })));
        }
      }
    } catch {
      // must never break the hook: skip a transcript line that fails to decode
    }
  }

  const results = await Promise.all(existChecks);
  const files = new Set<string>();
  for (const { path, exists } of results) {
    if (exists) {
      files.add(path);
    }
  }

  return { files: [...files], lineCount: lines.length };
}

// node_modules is a directory, so Bun.file(...).exists() (built for regular
// files) reads it as absent. readdir is the check that actually resolves it.
async function directoryMTime(path: string): Promise<number | null> {
  try {
    await readdir(path);
  } catch {
    // readdir fails only because the directory doesn't exist yet, which reads
    // as "needs install" the same way a missing node_modules always has.
    return null;
  }
  return Bun.file(path).lastModified;
}

async function fileMTime(path: string): Promise<number | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.lastModified : null;
}

// `bun install` only has work to do once a manifest changed since the install
// that produced the current node_modules.
async function needsInstall(cwd: string): Promise<boolean> {
  const modulesTime = await directoryMTime(join(cwd, "node_modules"));
  if (modulesTime == null) {
    return true;
  }
  const manifestTimes = await Promise.all(
    [join(cwd, "package.json"), join(cwd, "bun.lock")].map(fileMTime),
  );
  return manifestTimes.some((time) => time != null && time > modulesTime);
}

// prek hooks run repo scripts that import workspace packages, so the tree needs
// its dependencies present. A session can stop anywhere, including a directory
// that is not a JS project at all, where there is nothing to install. Failing to
// install is also not a check failure, and prek reports a missing dependency
// itself, so neither case belongs in the block path.
async function installDependencies(cwd: string): Promise<void> {
  if (!(await fileExists(join(cwd, "package.json")))) {
    return;
  }
  if (!(await needsInstall(cwd))) {
    return;
  }
  try {
    await execFileAsync("bun", ["install", "--cwd", cwd]);
  } catch {
    // must never break the hook
  }
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

const UNSAFE_SESSION = /[^A-Za-z0-9._-]+/g;

export function statePath(sessionId: string): string {
  return join(tmpdir(), "claude-stop-hook", `${sessionId.replace(UNSAFE_SESSION, "-")}.json`);
}

async function processedLines(sessionId: string): Promise<number> {
  try {
    const path = statePath(sessionId);
    return decode(ProcessedState, await Bun.file(path).json(), path).lineCount ?? 0;
  } catch {
    // A missing or corrupt state file means no Stop for this session has
    // recorded a position yet, so the transcript is scanned from the start.
    return 0;
  }
}

async function recordProcessedLines(sessionId: string, lineCount: number): Promise<void> {
  try {
    await Bun.write(statePath(sessionId), JSON.stringify({ lineCount }));
  } catch {
    // must never break the hook: the next Stop just rescans from the last recorded position
  }
}

export async function processStop(input: StopInput): Promise<SyncHookJSONOutput | null> {
  if (input.stop_hook_active) {
    return null;
  }

  if ((process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE ?? "") !== "") {
    return null;
  }

  const sinceLine = await processedLines(input.session_id);
  const { files, lineCount } = await parseTranscript(input.transcript_path, sinceLine);
  if (files.length === 0) {
    await recordProcessedLines(input.session_id, lineCount);
    return null;
  }

  const relativePaths = scopePaths(files, input.cwd);
  if (relativePaths.length === 0) {
    await recordProcessedLines(input.session_id, lineCount);
    return null;
  }

  await installDependencies(input.cwd);

  try {
    await execFileAsync("prek", ["run", "--files", ...relativePaths], {
      cwd: input.cwd,
      timeout: PREK_TIMEOUT,
    });
    await recordProcessedLines(input.session_id, lineCount);
    return null;
  } catch (error) {
    // The recorded position stays where it was: a blocked Stop must recheck
    // these same files, plus any new ones, until a run of this Stop passes.
    const failure = PrekFailure.safeParse(error);
    const execError = failure.success ? failure.data : {};
    const output = `${execError.stdout ?? ""}${execError.stderr ?? ""}`.trim();

    let context: string;
    if (execError.code === "ENOENT") {
      context = "prek is not installed or not in PATH";
    } else if (execError.killed) {
      context = `Checks timed out after ${PREK_TIMEOUT / 1000}s. Partial output:\n\n${output}`;
    } else {
      const detail = output !== "" ? output : (execError.message ?? "");
      context = `Check failures:\n\n${detail !== "" ? detail : String(error)}`;
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
    // Malformed hook input must not crash the hook. Skip this invocation.
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
