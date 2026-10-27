#!/usr/bin/env bun
// Copies a cloud session's transcripts to S3, one object per file overwritten
// in place, so the Mac's index can import cloud sessions as a host. A reclaimed
// VM never runs SessionEnd, so Stop uploads too, at most once per interval:
// a session abandoned mid-interval loses at most that much of its tail.

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

const HookInput = z.looseObject({
  hook_event_name: z.string().catch(""),
  transcript_path: z.string().catch(""),
  session_id: z.string().catch("unknown"),
});

export const STOP_INTERVAL_MS = 15 * 60 * 1000;

// When the last upload ran, and the size each file had then, so an upload
// skips the files that did not grow.
const State = z
  .object({ uploadedAt: z.number(), sizes: z.record(z.string(), z.number()) })
  .catch({ uploadedAt: 0, sizes: {} });

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

// The main transcript plus its subagents' transcripts.
export function sessionFiles(transcript: string): string[] {
  const subagents = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  let entries: string[] = [];
  try {
    entries = readdirSync(subagents)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(subagents, name));
  } catch {
    // No subagents ran.
  }
  return [transcript, ...entries];
}

// Keyed by remote session. A reopened session restores its full history into a
// fresh container, so its first upload overwrites the object with a superset.
export function objectKey(t: Target, session: string, root: string, file: string): string {
  return [t.prefix, session, relative(root, file)].filter((p) => p !== "").join("/");
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

  const failures: string[] = [];
  await Promise.all(
    sessionFiles(input.transcript_path).map(async (file) => {
      const body = Bun.file(file);
      if (!(await body.exists()) || state.sizes[file] === body.size) return;
      const key = `${target.base}/${objectKey(target, session, root, file)}`;
      const res = await fetch(key, { method: "PUT", body }).catch((error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
      );
      if (res instanceof Error || !res.ok) {
        failures.push(
          `${relative(root, file)}: ${res instanceof Error ? res.message : res.status}`,
        );
        return;
      }
      state.sizes[file] = body.size;
    }),
  );
  await Bun.write(statePath, JSON.stringify(state));
  if (failures.length > 0) console.error(`session upload failed: ${failures.join(", ")}`);
}

if (import.meta.main) await main();
