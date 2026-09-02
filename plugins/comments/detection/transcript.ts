import { z } from "zod";

const EditToolUse = z.object({
  type: z.literal("tool_use"),
  name: z.enum(["Edit", "Write", "MultiEdit"]),
  input: z.object({ file_path: z.string().optional() }),
});

const TranscriptLine = z.object({
  message: z.object({ content: z.array(z.unknown()) }).optional(),
});

/**
 * The absolute paths a session's `Edit`, `Write`, and `MultiEdit` calls named,
 * in first-touch order. A path repeated across edits appears once.
 */
export function editedPaths(transcript: string): string[] {
  const paths = new Set<string>();
  for (const line of transcript.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = TranscriptLine.safeParse(parsed);
    if (!record.success || record.data.message == null) continue;
    for (const raw of record.data.message.content) {
      const block = EditToolUse.safeParse(raw);
      if (!block.success) continue;
      const path = block.data.input.file_path;
      if (path != null && path !== "") paths.add(path);
    }
  }
  return [...paths];
}
