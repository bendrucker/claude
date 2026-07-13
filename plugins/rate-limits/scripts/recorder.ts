#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appendSample, type RateLimits, rateLimitsPath, sampleFromRateLimits } from "./history";

// Statusline wrapper. Claude Code pipes the statusline payload (with its
// `rate_limits` field) on stdin. This reads it once, mirrors rate_limits to
// rl.json and appends an edge-triggered history sample, then execs the inner
// statusline command with the same stdin. Recording is best-effort: a failure
// to mirror or record never blocks the inner statusline from rendering.
async function record(input: unknown, nowMs: number): Promise<void> {
  if (typeof input !== "object" || input === null) return;
  const rl = (input as { rate_limits?: RateLimits }).rate_limits;
  if (!rl) return;

  const path = rateLimitsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(rl));
  } catch {
    // Mirror is best-effort. Fall through to history and the inner statusline.
  }

  const sample = sampleFromRateLimits(rl, nowMs);
  if (sample) {
    try {
      await appendSample(sample);
    } catch {
      // History is best-effort. The inner statusline must still render.
    }
  }
}

// The README wires the recorder as `recorder.ts -- <inner-cmd>`, but neither Bun
// nor Node strips the `--` separator when it follows the script path, so it
// survives in argv. Drop a single leading `--` so the inner command is what gets
// spawned rather than the literal `--`.
export function innerArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

async function main(): Promise<void> {
  const stdinText = await Bun.stdin.text();

  try {
    await record(JSON.parse(stdinText), Date.now());
  } catch {
    // Unparseable payload still gets forwarded to the inner statusline verbatim.
  }

  const inner = innerArgv(process.argv.slice(2));
  if (inner.length === 0) {
    process.stdout.write(stdinText);
    return;
  }

  const proc = Bun.spawn(inner, {
    stdin: new Response(stdinText),
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `[rate-limits] recorder error: ${error instanceof Error ? error.message : error}`,
    );
  });
}
