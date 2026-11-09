import { z } from "zod";

const TraceLine = z.object({ type: z.string(), result: z.string().optional() });
const Usage = z.object({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});
const ModelUsage = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
});
const ResultLine = TraceLine.extend({
  num_turns: z.number().nullish(),
  duration_ms: z.number().nullish(),
  total_cost_usd: z.number().nullish(),
  usage: Usage.nullish(),
  modelUsage: z.record(z.string(), ModelUsage).nullish(),
});
type ResultLine = z.infer<typeof ResultLine>;
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

function lastResult(trace: string): ResultLine | undefined {
  const line = trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .findLast((l) => TraceLine.parse(JSON.parse(l)).type === "result");
  return line === undefined ? undefined : ResultLine.parse(JSON.parse(line));
}

export interface TokenUsage {
  /** Input, output, and cache tokens. */
  total: number;
  output: number;
}

function usageOf(line: ResultLine): TokenUsage | undefined {
  const models = Object.values(line.modelUsage ?? {});
  if (models.length > 0) {
    const sum = (pick: (m: z.infer<typeof ModelUsage>) => number | undefined) =>
      models.reduce((n, m) => n + (pick(m) ?? 0), 0);
    const output = sum((m) => m.outputTokens);
    const total =
      output +
      sum((m) => m.inputTokens) +
      sum((m) => m.cacheReadInputTokens) +
      sum((m) => m.cacheCreationInputTokens);
    return { total, output };
  }
  const usage = line.usage;
  if (usage == null) return undefined;
  const output = usage.output_tokens ?? 0;
  const total =
    output +
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return { total, output };
}

/**
 * A trace's tokens from its last `result` line, undefined when unmeasured. `modelUsage` counts
 * every model call including subagents, so it wins over `usage`, which counts the main loop only.
 */
export function traceUsage(trace: string): TokenUsage | undefined {
  const last = lastResult(trace);
  return last === undefined ? undefined : usageOf(last);
}

/** A trace's measures from its last `result` line, each absent when that line lacks it. */
export function traceMeasures(trace: string): Measured {
  const last = lastResult(trace);
  if (last === undefined) return {};
  return {
    words: last.result?.split(/\s+/).filter(Boolean).length,
    turns: last.num_turns ?? undefined,
    seconds: last.duration_ms == null ? undefined : last.duration_ms / 1000,
    tokens: usageOf(last)?.output,
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
