#!/usr/bin/env bun

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { decode, decodeJson, decodeStdin } from "../../../packages/decode/index";

// oxlint-disable-next-line typescript/strict-void-return -- tsc resolves promisify(execFile) through Node's [util.promisify.custom] overload correctly; a cast narrow enough to satisfy this rule trips typescript/no-unsafe-type-assertion instead.
const execFileAsync = promisify(execFile);
const PREK_TIMEOUT = 120_000;
const PREK_MAX_BUFFER = 16 * 1024 * 1024;

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

// `code` is the exit status on a non-zero exit and a string like "ENOENT" when
// the spawn itself failed.
const PrekFailure = z.looseObject({
  code: z.union([z.string(), z.number()]).optional(),
  killed: z.boolean().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  message: z.string().optional(),
});

const StopState = z.looseObject({
  lineCount: z.number().optional(),
  blocks: z.number().optional(),
});

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

const PREK_STATUS = /^\S.*?\.{2,}(?:\([^)]*\))?(Passed|Failed|Skipped)$/;
const FAILURE_TAIL_LINES = 40;

function tail(lines: string[]): string[] {
  if (lines.length <= FAILURE_TAIL_LINES) {
    return lines;
  }
  return [
    `... ${lines.length - FAILURE_TAIL_LINES} earlier lines omitted`,
    ...lines.slice(-FAILURE_TAIL_LINES),
  ];
}

interface HookReport {
  status: string;
  /** The status line, then the hook's `- key: value` fields and output. */
  lines: string[];
}

function outputLines(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());
}

function hookReports(lines: string[]): HookReport[] {
  const reports: HookReport[] = [];
  for (const line of lines) {
    const status = PREK_STATUS.exec(line)?.[1];
    if (status != null) {
      reports.push({ status, lines: [line] });
    } else {
      reports.at(-1)?.lines.push(line);
    }
  }
  return reports;
}

function field(report: HookReport, name: string): string | undefined {
  const prefix = `- ${name}`;
  const line = report.lines.find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).replace(/^:\s*/, "");
}

// A fixer such as oxfmt fails its hook by rewriting a file, which in a commit
// means "stage the fix and retry." At Stop the rewrite is the fix, and the hooks
// after it already ran on the rewritten text, so a run whose only failures are
// rewrites passed.
function fixedOnly(failed: HookReport[]): boolean {
  return failed.every(
    (report) =>
      field(report, "files were modified by this hook") !== undefined &&
      field(report, "exit code") === undefined,
  );
}

// Keeps each failing hook's status line and the tail of its output.
export function summarizePrekOutput(output: string): string {
  const lines = outputLines(output);
  const failed = hookReports(lines).filter((report) => report.status === "Failed");
  if (failed.length === 0) {
    return tail(lines).join("\n");
  }
  return failed
    .map(({ lines: [header = "", ...body] }) => [header, ...tail(body)].join("\n").trimEnd())
    .join("\n\n");
}

type Attributes = Record<string, number | string>;

// `-v` adds each hook's id and duration, which feed the per-hook timings.
function recordHooks(stdout: string, attributes: Attributes): HookReport[] {
  const reports = hookReports(outputLines(stdout));
  for (const report of reports) {
    const id = field(report, "hook id");
    const seconds = Number.parseFloat(field(report, "duration") ?? "");
    if (id != null && !Number.isNaN(seconds)) {
      attributes[`${id}_ms`] = Math.round(seconds * 1000);
    }
  }
  const failed = reports.filter((report) => report.status === "Failed");
  if (failed.length > 0) {
    attributes.failed = failed.map((report) => field(report, "hook id") ?? "?").join(",");
  }
  return failed;
}

type PrekResult = { ok: true } | { ok: false; environment: boolean; context: string };

async function runPrek(paths: string[], cwd: string, attributes: Attributes): Promise<PrekResult> {
  try {
    const { stdout } = await execFileAsync("prek", ["run", "-v", "--files", ...paths], {
      cwd,
      timeout: PREK_TIMEOUT,
      maxBuffer: PREK_MAX_BUFFER,
    });
    recordHooks(stdout, attributes);
    return { ok: true };
  } catch (error) {
    const failure = PrekFailure.safeParse(error);
    const execError = failure.success ? failure.data : {};
    const failed = recordHooks(execError.stdout ?? "", attributes);
    if (execError.killed !== true && failed.length > 0 && fixedOnly(failed)) {
      return { ok: true };
    }
    if (execError.code === "ENOENT") {
      return { ok: false, environment: true, context: "prek is not installed or not in PATH" };
    }

    const output = [execError.stdout, execError.stderr]
      .map((stream) => summarizePrekOutput(stream ?? ""))
      .filter((summary) => summary !== "")
      .join("\n\n");
    if (execError.killed === true) {
      return {
        ok: false,
        environment: false,
        context: `Checks timed out after ${PREK_TIMEOUT / 1000}s. Partial output:\n\n${output}`,
      };
    }
    const detail = output !== "" ? output : (execError.message ?? "");
    return {
      ok: false,
      environment: false,
      context: `Check failures:\n\n${detail !== "" ? detail : String(error)}`,
    };
  }
}

const UNSAFE_SESSION = /[^A-Za-z0-9._-]+/g;

function safeSession(sessionId: string): string {
  return sessionId.replace(UNSAFE_SESSION, "-");
}

export function statePath(sessionId: string): string {
  return join(tmpdir(), "claude-stop-hook", `${safeSession(sessionId)}.json`);
}

interface State {
  lineCount: number;
  blocks: number;
}

async function readState(sessionId: string): Promise<State> {
  try {
    const path = statePath(sessionId);
    const state = decode(StopState, await Bun.file(path).json(), path);
    return { lineCount: state.lineCount ?? 0, blocks: state.blocks ?? 0 };
  } catch {
    // A missing or corrupt state file means no Stop for this session has
    // recorded a position yet, so the transcript is scanned from the start.
    return { lineCount: 0, blocks: 0 };
  }
}

async function writeState(sessionId: string, state: State): Promise<boolean> {
  try {
    await Bun.write(statePath(sessionId), JSON.stringify(state));
    return true;
  } catch {
    // An unwritable state file must not fail the hook. The next Stop rescans
    // from the last recorded position, and the caller declines to block.
    return false;
  }
}

// A blocked Stop wakes the model to repair, and the Stop that follows carries
// stop_hook_active. Waving that one through would end the session on a repair
// nothing checked, so it is checked too, and a count of consecutive blocks
// bounds it, since an error the model cannot clear would otherwise block every
// Stop forever.
export const STOP_BLOCK_LIMIT = 2;

// Written in the mod-events layout so the session index reads it into
// `mod_events` alongside the mods.
export function stopEventsDir(sessionId: string): string {
  const config = setEnv("CLAUDE_CONFIG_DIR") ?? join(homedir(), ".claude");
  const root = setEnv("STOP_EVENTS_DIR") ?? join(config, "mod-events");
  return join(root, safeSession(sessionId));
}

function setEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

async function recordStop(sessionId: string, attributes: Attributes): Promise<void> {
  const record = {
    timestamp: new Date().toISOString(),
    severity_text: attributes.outcome === "error" ? "WARN" : "INFO",
    severity_number: attributes.outcome === "error" ? 13 : 9,
    event_name: "prek.stop",
    attributes: { "session.id": sessionId, ...attributes },
    scope: { name: "prek" },
  };
  try {
    const path = join(stopEventsDir(sessionId), `prek.${Date.now()}.${process.pid}.jsonl`);
    await Bun.write(path, `${JSON.stringify(record)}\n`);
  } catch {
    // Telemetry must never fail the hook.
  }
}

type Outcome = "skip" | "pass" | "block" | "warn" | "error";

interface Verdict {
  outcome: Outcome;
  output: SyncHookJSONOutput | null;
}

async function gate(input: StopInput, attributes: Attributes): Promise<Verdict> {
  const state = await readState(input.session_id);
  const { files, lineCount } = await parseTranscript(input.transcript_path, state.lineCount);
  const relativePaths = scopePaths(files, input.cwd);
  attributes.files = relativePaths.length;
  if (relativePaths.length === 0) {
    await writeState(input.session_id, { lineCount, blocks: 0 });
    return { outcome: "skip", output: null };
  }

  await installDependencies(input.cwd);
  const result = await runPrek(relativePaths, input.cwd, attributes);
  if (result.ok) {
    await writeState(input.session_id, { lineCount, blocks: 0 });
    return { outcome: "pass", output: null };
  }
  if (result.environment) {
    return {
      outcome: "error",
      output: { systemMessage: `⚠️ Stop checks skipped: ${result.context}` },
    };
  }

  // A Stop the model did not arrive at through a block starts a fresh round,
  // and the recorded position stays put so the next Stop rechecks these files.
  const blocked = input.stop_hook_active === true ? state.blocks : 0;
  attributes.blocks = blocked + 1;
  // Blocking is only safe once the count that will later release it is on disk.
  if (
    blocked < STOP_BLOCK_LIMIT &&
    (await writeState(input.session_id, { lineCount: state.lineCount, blocks: blocked + 1 }))
  ) {
    return { outcome: "block", output: { decision: "block", reason: result.context } };
  }

  await writeState(input.session_id, { lineCount, blocks: 0 });
  return {
    outcome: "warn",
    output: {
      systemMessage: `⚠️ Stop checks are no longer blocking, so this stop goes through with these in place:\n\n${result.context}`,
    },
  };
}

export async function processStop(input: StopInput): Promise<SyncHookJSONOutput | null> {
  const start = performance.now();
  const attributes: Attributes = {};
  let outcome: Outcome = "error";
  try {
    const verdict = await gate(input, attributes);
    outcome = verdict.outcome;
    return verdict.output;
  } finally {
    await recordStop(input.session_id, {
      ...attributes,
      outcome,
      duration_ms: Math.round(performance.now() - start),
    });
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
