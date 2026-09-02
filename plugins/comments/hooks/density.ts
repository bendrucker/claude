#!/usr/bin/env bun

import { basename } from "node:path";
import { z } from "zod";
import { scoreTree } from "../detection/tree";
import { editedPaths } from "../detection/transcript";

const StopInput = z.object({
  hook_event_name: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

/** Stable token at the start of every block reason, scanned for to avoid re-blocking. */
const MARKER = "comment-density:";

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });

const TranscriptLine = z.object({
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }).optional(),
  attachment: z
    .object({
      hookEvent: z.string().optional(),
      stdout: z.string().optional(),
      blockingError: z
        .union([z.string(), z.object({ blockingError: z.string().optional() })])
        .optional(),
    })
    .optional(),
});

/** Prefix the harness puts on the message that relays a block reason. */
const FEEDBACK = "Stop hook feedback";

/**
 * A prior block leaves two records: a hook attachment whose stdout carries the
 * block JSON, and a feedback message relaying the reason. Matching only those
 * channels keeps tool payloads and ordinary prose mentioning the marker (say,
 * work on this file) from suppressing a live block. The whole transcript is
 * scanned, so the block survives however many turns follow it.
 */
function blockedEarlier(transcript: string): boolean {
  const relayed = (text: string): boolean => text.includes(MARKER) && text.includes(FEEDBACK);
  return transcript.split("\n").some((line) => {
    if (!line.includes(MARKER)) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    const decoded = TranscriptLine.safeParse(parsed);
    if (!decoded.success) return false;
    const attachment = decoded.data.attachment;
    if (attachment?.hookEvent === "Stop") {
      const blocking = attachment.blockingError;
      let reason = "";
      if (typeof blocking === "string") {
        reason = blocking;
      } else if (blocking != null) {
        reason = blocking.blockingError ?? "";
      }
      if (attachment.stdout?.includes(MARKER) === true || reason.includes(MARKER)) return true;
    }
    const content = decoded.data.message?.content;
    if (content == null) return false;
    if (typeof content === "string") return relayed(content);
    return content.some((block) => {
      const text = TextBlock.safeParse(block);
      return text.success && relayed(text.data.text);
    });
  });
}

async function main(): Promise<void> {
  let input: z.output<typeof StopInput>;
  try {
    input = StopInput.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    return;
  }
  if (input.hook_event_name !== "Stop") return;
  if (input.stop_hook_active === true) return;
  const path = input.transcript_path;
  if (path == null || path === "") return;

  let transcript: string;
  try {
    transcript = await Bun.file(path).text();
  } catch {
    return;
  }

  const paths = editedPaths(transcript);
  if (paths.length === 0) return;

  const { session } = await scoreTree({ cwd: input.cwd ?? process.cwd(), paths });
  if (session.tier !== "strong") return;
  if (blockedEarlier(transcript)) return;

  const worst = session.worstFiles
    .slice(0, 3)
    .map((file) => `${basename(file.path)} +${Math.round(file.excessChars)} chars`)
    .join(", ");
  const reason = `${MARKER} the comments this session added to the branch run ${Math.round(session.excessChars)} chars over the language baseline (${worst}). Run the comments:audit skill on the diff and trim what it flags before stopping.`;
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

if (import.meta.main) {
  main().catch(() => {});
}
