import { z } from "zod";

const TraceLine = z.object({ type: z.string(), result: z.string().optional() });
const ResultLine = TraceLine.extend({
  num_turns: z.number().nullish(),
  duration_ms: z.number().nullish(),
  total_cost_usd: z.number().nullish(),
  usage: z.object({ output_tokens: z.number().nullish() }).nullish(),
});
const ToolUse = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.looseObject({ file_path: z.string().optional(), skill: z.string().optional() }),
});
const Assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});

export const measures = ["words", "turns", "seconds", "tokens", "cost"] as const;
export type Measure = (typeof measures)[number];
export type Measured = Partial<Record<Measure, number | undefined>>;

/** The final reply in a trace: its last `result` line. */
export function traceReply(trace: string): string | undefined {
  for (const line of trace.trim().split("\n").toReversed()) {
    const entry = TraceLine.parse(JSON.parse(line));
    if (entry.type === "result" && entry.result !== undefined) return entry.result;
  }
  return undefined;
}

/** A trace's measures from its last `result` line, each absent when that line lacks it. */
export function traceMeasures(trace: string): Measured {
  const line = trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .findLast((l) => TraceLine.parse(JSON.parse(l)).type === "result");
  if (line === undefined) return {};
  const last = ResultLine.parse(JSON.parse(line));
  return {
    words: last.result?.split(/\s+/).filter(Boolean).length,
    turns: last.num_turns ?? undefined,
    seconds: last.duration_ms == null ? undefined : last.duration_ms / 1000,
    tokens: last.usage?.output_tokens ?? undefined,
    cost: last.total_cost_usd ?? undefined,
  };
}

/** Strips a session's temp prefix so the same file reads the same across runs. */
export function shortPath(path: string): string {
  const cwd = path.indexOf("/home/cwd/");
  if (cwd !== -1) return path.slice(cwd + "/home/cwd/".length);
  const plugins = path.lastIndexOf("/plugins/");
  return plugins === -1 ? path : path.slice(plugins + "/plugins/".length);
}

/**
 * Names each tool call in a trace: `Read <path>` for a file read and `Skill <name>` for a skill
 * load, since those show whether a session opened what it was pointed at, and the bare tool
 * name otherwise. A file named in injected skill text never appears here.
 */
export function calls(trace: string): string[] {
  return trace
    .trim()
    .split("\n")
    .flatMap((raw) => {
      const line = Assistant.safeParse(JSON.parse(raw));
      return line.success ? line.data.message.content : [];
    })
    .flatMap((block) => {
      const use = ToolUse.safeParse(block);
      if (!use.success) return [];
      const { name, input } = use.data;
      if (name === "Read" && input.file_path !== undefined)
        return [`Read ${shortPath(input.file_path)}`];
      if (name === "Skill" && input.skill !== undefined) return [`Skill ${input.skill}`];
      return [name];
    });
}
