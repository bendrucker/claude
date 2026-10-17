import { z } from "zod";
import { traceReply } from "../../../../../evals/native/load";

const ToolResult = z.object({
  type: z.literal("tool_result"),
  content: z.union([
    z.string(),
    z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  ]),
});
const TraceLine = z.looseObject({
  message: z.looseObject({ content: z.unknown() }).optional(),
});

const STUB_BLOCK = /^PR-BODY-BEGIN[^\S\n]*\n([\s\S]*?)\n?^PR-BODY-END[^\S\n]*$/gm;

export interface Body {
  text: string;
  source: "stub" | "reply";
}

function toolResultTexts(trace: string): string[] {
  return trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      const line = TraceLine.safeParse(JSON.parse(l));
      const content = line.success ? line.data.message?.content : undefined;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block: unknown) => {
        const result = ToolResult.safeParse(block);
        if (!result.success) return [];
        const { content: c } = result.data;
        return typeof c === "string" ? [c] : [c.map((p) => p.text ?? "").join("")];
      });
    });
}

/** The PR body a run produced: the last stub block in a tool result, else the reply after its `Title:` line. */
export function bodyOf(trace: string): Body | undefined {
  const blocks = toolResultTexts(trace).flatMap((t) => t.matchAll(STUB_BLOCK).toArray());
  const stub = blocks.at(-1)?.[1];
  if (stub !== undefined) return { text: stub, source: "stub" };
  const reply = traceReply(trace);
  const title = reply === undefined ? null : /^Title:.*$/m.exec(reply);
  if (reply === undefined || title === null) return undefined;
  return { text: reply.slice(title.index + title[0].length).trim(), source: "reply" };
}
