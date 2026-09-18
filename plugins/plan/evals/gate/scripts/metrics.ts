import { z } from "zod";
import { normalizeLines } from "../../../hooks/gate";
import { SIZE_LIMIT } from "./arms";

const ToolUse = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  input: z.looseObject({ command: z.string().optional() }).optional(),
});

const StreamLine = z.looseObject({
  type: z.string(),
  message: z.looseObject({ content: z.array(ToolUse).optional() }).optional(),
  result: z.string().optional(),
  usage: z.looseObject({ output_tokens: z.number().optional() }).optional(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
});

export const TranscriptMetrics = z.object({
  tools: z.record(z.string(), z.number()),
  wc_calls: z.number(),
  edits: z.number(),
  writes: z.number(),
  output_tokens: z.number(),
  turns: z.number(),
  duration_ms: z.number(),
  cost_usd: z.number(),
  done: z.boolean(),
});
export type TranscriptMetrics = z.infer<typeof TranscriptMetrics>;

const COUNTS_CHARS = /\bwc\b/;

function parseLine(line: string): z.infer<typeof StreamLine> | null {
  try {
    const parsed = StreamLine.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

export function transcriptMetrics(lines: readonly string[]): TranscriptMetrics {
  const metrics: TranscriptMetrics = {
    tools: {},
    wc_calls: 0,
    edits: 0,
    writes: 0,
    output_tokens: 0,
    turns: 0,
    duration_ms: 0,
    cost_usd: 0,
    done: false,
  };
  for (const raw of lines) {
    const line = parseLine(raw);
    if (line === null) continue;
    if (line.type === "assistant") {
      for (const block of line.message?.content ?? []) {
        if (block.type !== "tool_use" || block.name === undefined) continue;
        metrics.tools[block.name] = (metrics.tools[block.name] ?? 0) + 1;
        if (block.name === "Edit") metrics.edits++;
        if (block.name === "Write") metrics.writes++;
        if (block.name === "Bash" && COUNTS_CHARS.test(block.input?.command ?? "")) {
          metrics.wc_calls++;
        }
      }
    }
    if (line.type === "result") {
      metrics.output_tokens = line.usage?.output_tokens ?? 0;
      metrics.turns = line.num_turns ?? 0;
      metrics.duration_ms = line.duration_ms ?? 0;
      metrics.cost_usd = line.total_cost_usd ?? 0;
      metrics.done = /\bDONE\b/.test(line.result ?? "");
    }
  }
  return metrics;
}

export const LineAccounting = z.object({
  before: z.number(),
  after: z.number(),
  carried: z.number(),
  moved: z.number(),
  deleted: z.number(),
});
export type LineAccounting = z.infer<typeof LineAccounting>;

/**
 * Where each line of the denied plan ended up: still in the plan, in a sidecar,
 * or gone. A reworded line counts as gone, so `deleted` is an upper bound on
 * content loss, the same bound for every arm.
 */
export function lineAccounting(
  before: string,
  after: string,
  sidecars: readonly string[],
): LineAccounting {
  const previous = normalizeLines(before);
  const current = normalizeLines(after);
  const relocated = new Set(sidecars.flatMap((text) => [...normalizeLines(text)]));
  let carried = 0;
  let moved = 0;
  for (const line of previous) {
    if (current.has(line)) carried++;
    else if (relocated.has(line)) moved++;
  }
  return {
    before: previous.size,
    after: current.size,
    carried,
    moved,
    deleted: previous.size - carried - moved,
  };
}

export const NEAR_LIMIT_MARGIN = 1_000;

export function overLimit(chars: number): boolean {
  return chars > SIZE_LIMIT;
}

export function nearLimit(chars: number): boolean {
  return chars <= SIZE_LIMIT && chars > SIZE_LIMIT - NEAR_LIMIT_MARGIN;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

export const CaseResult = z.object({
  id: z.string(),
  arm: z.string(),
  model: z.string(),
  chars_before: z.number(),
  chars_after: z.number().nullable(),
  over_limit: z.boolean(),
  near_limit: z.boolean(),
  sidecars: z.array(z.object({ name: z.string(), chars: z.number() })),
  lines: LineAccounting,
  transcript: TranscriptMetrics,
  exit_code: z.number(),
});
export type CaseResult = z.infer<typeof CaseResult>;
