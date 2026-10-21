#!/usr/bin/env bun
// Copies a cloud session's transcript to S3 at the end of every turn, so the
// Mac's index can import cloud sessions as a host. It runs on Stop because a
// reclaimed VM never runs SessionEnd.

import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

const HookInput = z.looseObject({
  transcript_path: z.string().catch(""),
  session_id: z.string().catch("unknown"),
});

// Sizes already uploaded, so a turn re-sends only the files that grew.
const State = z.record(z.string(), z.number()).catch({});

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

// The main transcript plus its subagents' transcripts and metadata.
export function sessionFiles(transcript: string): string[] {
  const subagents = join(dirname(transcript), basename(transcript, ".jsonl"), "subagents");
  let entries: string[] = [];
  try {
    entries = readdirSync(subagents).map((name) => join(subagents, name));
  } catch {
    // No subagents ran.
  }
  return [transcript, ...entries];
}

// Keyed by remote session and container: a reopened session lands in a fresh
// container with its history restored, and a separate key keeps that restore
// from overwriting the copy it was restored from. The index dedupes the
// replayed lines by uuid.
export function objectKey(
  t: Target,
  session: string,
  container: string,
  root: string,
  file: string,
): string {
  return [t.prefix, session, container, relative(root, file)].filter((p) => p !== "").join("/");
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
  const container = env.CLAUDE_CODE_CONTAINER_ID ?? "unknown";
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

  const failures: string[] = [];
  await Promise.all(
    sessionFiles(input.transcript_path).map(async (file) => {
      const body = Bun.file(file);
      if (!(await body.exists()) || state[file] === body.size) return;
      const key = `${target.base}/${objectKey(target, session, container, root, file)}`;
      const res = await fetch(key, { method: "PUT", body }).catch((error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
      );
      if (res instanceof Error || !res.ok) {
        failures.push(
          `${relative(root, file)}: ${res instanceof Error ? res.message : res.status}`,
        );
        return;
      }
      state[file] = body.size;
    }),
  );
  await Bun.write(statePath, JSON.stringify(state));
  if (failures.length > 0) console.error(`session upload failed: ${failures.join(", ")}`);
}

if (import.meta.main) await main();
