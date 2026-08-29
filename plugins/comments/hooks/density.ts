#!/usr/bin/env bun

import { basename } from "node:path";
import { z } from "zod";
import { scoreTranscript } from "../detection/density";

const StopInput = z.object({
  hook_event_name: z.string().optional(),
  transcript_path: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

/** Stable token at the start of every block reason, scanned for to avoid re-blocking. */
const MARKER = "comment-density:";

const TAIL_LINES = 200;

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });

const TailLine = z.object({
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }).optional(),
  attachment: z
    .object({ hookEvent: z.string().optional(), stdout: z.string().optional() })
    .optional(),
});

/** Prefix the harness puts on the message that relays a block reason. */
const FEEDBACK = "Stop hook feedback";

/**
 * A prior block leaves two records: a hook attachment whose stdout carries the
 * block JSON, and a feedback message relaying the reason. Matching only those
 * channels keeps tool payloads and ordinary prose mentioning the marker (say,
 * work on this file) from suppressing a live block.
 */
function blockedRecently(transcript: string): boolean {
  const relayed = (text: string): boolean => text.includes(MARKER) && text.includes(FEEDBACK);
  return transcript
    .split("\n")
    .slice(-TAIL_LINES)
    .some((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return false;
      }
      const decoded = TailLine.safeParse(parsed);
      if (!decoded.success) return false;
      const attachment = decoded.data.attachment;
      if (attachment?.hookEvent === "Stop" && attachment.stdout?.includes(MARKER) === true) {
        return true;
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
