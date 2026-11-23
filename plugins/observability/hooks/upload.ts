#!/usr/bin/env bun
// Copies a cloud session's transcripts and mod events to S3, one object per
// file overwritten in place, so the Mac's index can import cloud sessions as a
// host. A reclaimed
// VM never runs SessionEnd, so Stop uploads too, at most once per interval:
// a session abandoned mid-interval loses at most that much of its tail.

import { readdirSync } from "node:fs";
// oxlint-disable-next-line no-restricted-imports -- Bun has no append, and a read-then-write could drop a concurrent hook's line.
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

const HookInput = z.looseObject({
  hook_event_name: z.string().catch(""),
  transcript_path: z.string().catch(""),
  session_id: z.string().catch("unknown"),
});

export const STOP_INTERVAL_MS = 15 * 60 * 1000;

// When the last upload ran, the size each file had then, so an upload skips
// the files that did not grow, and the failure kinds already reported.
const State = z
  .object({
    uploadedAt: z.number(),
    sizes: z.record(z.string(), z.number()),
    reported: z.array(z.string()).default([]),
  })
  .catch({ uploadedAt: 0, sizes: {}, reported: [] });

export function due(event: string, uploadedAt: number, now: number): boolean {
  return event !== "Stop" || now - uploadedAt >= STOP_INTERVAL_MS;
}

export interface Target {
  base: string;
  prefix: string;
}

// `s3://bucket/prefix` → virtual-hosted URL. The cloud proxy signs the request,
// so the hook sends it unsigned.
export function parseTarget(url: string, region: string | undefined): Target | undefined {
  const match = /^s3:\/\/([^/]+)\/?(.*?)\/?$/.exec(url);
  if (match === null) return undefined;
  const [, bucket, prefix] = match;
  const host =
    region !== undefined && region !== ""
      ? `${bucket}.s3.${region}.amazonaws.com`
      : `${bucket}.s3.amazonaws.com`;
  return { base: `https://${host}`, prefix: prefix ?? "" };
}

// Where the mod events of one session sit under its prefix. pull.ts moves them
// out of the transcripts, into the host's own mod-events directory.
export const MOD_EVENTS = "mod-events";

// The main transcript, its subagents' transcripts, and the session's mod
// events, each with its key relative to the session.
export function sessionFiles(transcript: string, modEventsDir?: string): [string, string][] {
  const root = dirname(transcript);
  const subagents = join(root, basename(transcript, ".jsonl"), "subagents");
  const files = [transcript, ...jsonlIn(subagents)].map((file): [string, string] => [
    file,
    relative(root, file),
  ]);
  if (modEventsDir === undefined) return files;
  return [
    ...files,
    ...jsonlIn(modEventsDir).map((file): [string, string] => [
      file,
      `${MOD_EVENTS}/${basename(file)}`,
    ]),
  ];
}

function jsonlIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    // Nothing ran there.
    return [];
  }
}

// Keyed by remote session. A reopened session restores its full history into a
// fresh container, so its first upload overwrites the object with a superset.
export function objectKey(t: Target, session: string, key: string): string {
  return [t.prefix, session, key].filter((p) => p !== "").join("/");
}

// The mod name the hook's failure events carry, as `scope.name`.
export const UPLOAD_MOD = "session-upload";

export interface Failure {
  /** The file's key relative to the session, never the full object key. */
  file: string;
  /** The HTTP status of a response that was not ok. */
  status?: number;
  /** The error code or class of a fetch that threw. Its message may carry the URL. */
  error?: string;
}

type Put = (url: string, init: { method: "PUT"; body: Blob }) => Promise<Response>;

// PUTs each file that grew since the last upload and records the new sizes in
// `sizes`. A failed file keeps its old size, so the next upload retries it.
export async function uploadFiles(
  files: [string, string][],
  urlOf: (rel: string) => string,
  sizes: Record<string, number>,
  put: Put = fetch,
): Promise<{ attempted: number; failures: Failure[] }> {
  let attempted = 0;
  const failures: Failure[] = [];
  await Promise.all(
    files.map(async ([file, rel]) => {
      const body = Bun.file(file);
      if (!(await body.exists()) || sizes[file] === body.size) return;
      attempted += 1;
      try {
        const res = await put(urlOf(rel), { method: "PUT", body });
        if (!res.ok) {
          failures.push({ file: rel, status: res.status });
          return;
        }
      } catch (error) {
        failures.push({ file: rel, error: errorCode(error) });
        return;
      }
      sizes[file] = body.size;
    }),
  );
  failures.sort((a, b) => a.file.localeCompare(b.file));
  return { attempted, failures };
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    return "code" in error && typeof error.code === "string" ? error.code : error.name;
  }
  return typeof error;
}

/**
 * Why a run failed. `unsigned` is a 403 on every file, which is what an
 * environment without the proxy's SigV4 secret gets.
 */
export type FailureKind = "unsigned" | "http" | "network";

export function failureKind(attempted: number, failures: Failure[]): FailureKind {
  if (failures.length === attempted && failures.every((f) => f.status === 403)) return "unsigned";
  return failures.some((f) => f.status !== undefined) ? "http" : "network";
}

// The kind to report for this run, or undefined when it succeeded or the
// session already reported that kind, so a session that can never upload logs
// once rather than on every Stop.
export function unreported(
  attempted: number,
  failures: Failure[],
  reported: string[],
): FailureKind | undefined {
  if (failures.length === 0) return undefined;
  const kind = failureKind(attempted, failures);
  return reported.includes(kind) ? undefined : kind;
}

const MESSAGES: Record<FailureKind, string> = {
  unsigned:
    "every PUT returned 403: this environment has no SigV4 network secret for the upload bucket",
  http: "some PUTs returned an HTTP error",
  network: "some PUTs could not reach the bucket",
};

// stderr from a hook that exits 0 reaches no one, so a newly seen failure kind
// also goes to the user.
export function failureMessage(kind: FailureKind, failures: Failure[]): string {
  const files = failures.map((f) => `${f.file}: ${f.status ?? f.error}`).join(", ");
  return `session upload failed (${kind}): ${MESSAGES[kind]}. ${files}`;
}

// The mod-events record for a run with failures, so the session index's `mods`
// query counts it as a failed `session-upload.upload`.
export function failureRecord(
  hook: string,
  attempted: number,
  failures: Failure[],
  sessionId: string,
  at: Date,
): Record<string, unknown> {
  const kind = failureKind(attempted, failures);
  const statuses = [
    ...new Set(failures.flatMap((f) => (f.status === undefined ? [] : [f.status]))),
  ];
  return {
    timestamp: at.toISOString(),
    severity_text: "WARN",
    severity_number: 13,
    event_name: `${UPLOAD_MOD}.upload`,
    attributes: {
      kind,
      message: MESSAGES[kind],
      hook,
      attempted,
      failed: failures.length,
      statuses: statuses.toSorted((a, b) => a - b),
      failures,
      "session.id": sessionId,
    },
    resource: { "service.name": "claude-code", "claude_code.surface": "cloud" },
    scope: { name: UPLOAD_MOD },
  };
}

// Appends to the session's own mod-events directory, which this hook uploads,
// so the record reaches the bucket on the first upload that succeeds.
export async function recordFailure(dir: string, record: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const day = String(record.timestamp).slice(0, 10);
    await appendFile(join(dir, `${UPLOAD_MOD}.${day}.jsonl`), `${JSON.stringify(record)}\n`);
  } catch (error) {
    console.error(`session upload: failure event not recorded: ${String(error)}`);
  }
}

async function main(): Promise<void> {
  const env = process.env;
  const url = env.CLAUDE_SESSION_UPLOAD_URL ?? "";
  if (env.CLAUDE_CODE_REMOTE !== "true" || url === "") return;
  const target = parseTarget(url, env.AWS_REGION);
  if (target === undefined) {
    console.error(`CLAUDE_SESSION_UPLOAD_URL must be s3://bucket/prefix, got ${url}`);
    return;
  }

  const input = HookInput.parse(await Bun.stdin.json());
  if (input.transcript_path === "") return;
  const session = env.CLAUDE_CODE_REMOTE_SESSION_ID ?? input.session_id;
  const root = dirname(input.transcript_path);
  // The mod-events plugin writes beside projects/, keyed by the local session id.
  const modEvents = join(dirname(dirname(root)), MOD_EVENTS, input.session_id);

  const statePath = join(
    tmpdir(),
    `session-upload-${basename(input.transcript_path, ".jsonl")}.json`,
  );
  const state = State.parse(
    await Bun.file(statePath)
      .json()
      .catch(() => ({})),
  );
  const now = Date.now();
  if (!due(input.hook_event_name, state.uploadedAt, now)) return;
  state.uploadedAt = now;

  const { attempted, failures } = await uploadFiles(
    sessionFiles(input.transcript_path, modEvents),
    (rel) => `${target.base}/${objectKey(target, session, rel)}`,
    state.sizes,
  );
  if (failures.length > 0) {
    console.error(
      `session upload failed: ${failures.map((f) => `${f.file}: ${f.status ?? f.error}`).join(", ")}`,
    );
  }
  const kind = unreported(attempted, failures, state.reported);
  if (kind !== undefined) {
    state.reported.push(kind);
    await recordFailure(
      modEvents,
      failureRecord(input.hook_event_name, attempted, failures, input.session_id, new Date(now)),
    );
    console.log(JSON.stringify({ systemMessage: failureMessage(kind, failures) }));
  }
  await Bun.write(statePath, JSON.stringify(state));
}

if (import.meta.main) await main();
