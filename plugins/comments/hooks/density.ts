#!/usr/bin/env bun

import { basename } from "node:path";
import { scoreTranscript } from "../detection/density";

interface StopInput {
  hook_event_name?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

/** Stable token at the start of every block reason, scanned for to avoid re-blocking. */
const MARKER = "comment-density:";

const TAIL_LINES = 200;

function blockedRecently(transcript: string): boolean {
  return transcript.split("\n").slice(-TAIL_LINES).some((line) => line.includes(MARKER));
}

async function main(): Promise<void> {
  let input: StopInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as StopInput;
  } catch {
    return;
  }
  if (input.hook_event_name !== "Stop") return;
  if (input.stop_hook_active) return;
  const path = input.transcript_path;
  if (!path) return;

  let transcript: string;
  try {
    transcript = await Bun.file(path).text();
  } catch {
    return;
  }

  const { session } = await scoreTranscript(path);
  if (session.tier !== "strong") return;
  if (blockedRecently(transcript)) return;

  const worst = session.worstFiles
    .slice(0, 3)
    .map((file) => `${basename(file.path)} +${Math.round(file.excessChars)} chars`)
    .join(", ");
  const reason = `${MARKER} this session's added comments run ${Math.round(session.excessChars)} chars over the language baseline (${worst}). Run the comments:audit skill on the diff before stopping.`;
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

if (import.meta.main) {
  main().catch(() => {});
}
