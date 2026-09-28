#!/usr/bin/env bun
import { basename, dirname, join } from "node:path";
import { globSync } from "node:fs";
import { cli } from "cleye";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { pFloor, pValue } from "../../../../../evals/native/compare";
import { scoreText } from "../../../skills/scan/scripts/score";
import { extractDeliverable, parseMap } from "./pairwise";

const ModelUsageEntry = z.looseObject({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadInputTokens: z.number().optional(),
  cacheCreationInputTokens: z.number().optional(),
});

const Usage = z.looseObject({
  input_tokens: z.number().nullish(),
  output_tokens: z.number().nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
});

const ResultLine = z.looseObject({
  type: z.literal("result"),
  usage: Usage.optional(),
  modelUsage: z.record(z.string(), ModelUsageEntry).optional(),
});

export interface TokenUsage {
  total: number;
  output: number;
}

/**
 * Token usage read off a trace's final `result` line. `modelUsage` (per-model totals for
 * every call the query pipeline made: main loop, Task subagents, and internal calls) is
 * preferred over `usage` (main agent loop only), per the Agent SDK's own field docs
 * (`@anthropic-ai/claude-agent-sdk` `sdk.d.ts`, `SDKResultSuccess`/`SDKResultError`). Both
 * fields are cumulative across turns, so only the trace's last `result` line is read, mirroring
 * `traceReply`. Returns undefined when neither field is present, which a caller must treat as
 * "unmeasured," not zero: no fixture trace with real usage was available to confirm the field
 * actually ships on a `claude plugin eval` trace, only its SDK type declaration.
 */
export function tokenUsage(trace: string): TokenUsage | undefined {
  for (const raw of trace.trim().split("\n").toReversed()) {
    if (raw === "") continue;
    const line = ResultLine.safeParse(JSON.parse(raw));
    if (!line.success) continue;

    const models = line.data.modelUsage;
    if (models !== undefined && Object.keys(models).length > 0) {
      let total = 0;
      let output = 0;
      for (const m of Object.values(models)) {
        const out = m.outputTokens ?? 0;
        total +=
          (m.inputTokens ?? 0) +
          out +
          (m.cacheReadInputTokens ?? 0) +
          (m.cacheCreationInputTokens ?? 0);
        output += out;
      }
      return { total, output };
    }

    const usage = line.data.usage;
    if (usage === undefined) return undefined;
    const output = usage.output_tokens ?? 0;
    const total =
      (usage.input_tokens ?? 0) +
      output +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    return { total, output };
  }
  return undefined;
}

const User = z.object({
  type: z.literal("user"),
  message: z.looseObject({ content: z.array(z.unknown()).default([]) }),
});
const ToolResultBlock = z.looseObject({
  type: z.literal("tool_result"),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
});
const TextBlock = z.looseObject({ text: z.string().optional() });

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => TextBlock.safeParse(block).data?.text ?? "").join("\n");
  }
  return "";
}

// The only `permissionDecision: "deny"` outputs the writing plugin's hooks can produce, so the
// substrings below are exhaustive rather than a sample. In `plugins/writing/detection/tropes.ts`
// only the "salutation" and "spaced em dash" categories carry `structural: true`, the flag
// `check-tropes.ts`'s `processSideEffect` requires to block a Bash call (PR/issue body prose);
// every other deny-tier category there only ever reaches `formatContext`, a reminder that lets
// the call through. `plugins/writing/hooks/numbering.ts` denies only a Write/Edit to a
// non-markdown file. Hand-maintained the same way, and for the same reason, as
// `plugins/claude-code/skills/session/resources/views.sql`'s `hook_denies` patterns: a hook
// builds its reason at runtime, so the string cannot be read off source, and it drifts as hooks
// are reworded.
export const WRITING_DENY_MARKERS = [
  "are an AI writing tell",
  "opens the comment with a salutation",
  "Detected step or phase numbering that creates tight coupling",
];

// Since 2026-09-19 the harness prepends this before a PreToolUse deny's reason reaches the
// denied call's tool_result (see the `hook_denies` view comment cited above). Stripping it is
// not required for the substring match above, but keeps `reason` comparable to the hook's own
// source text.
const HARNESS_PREFIX = /^\s*PreToolUse:\w+ hook error:\s*/;

/**
 * Count of writing-hook denies in a trace. A PreToolUse hook returning `permissionDecision:
 * "deny"` writes no separate hook record: the surviving trace is a `tool_result` with
 * `is_error: true` whose content is the hook's `permissionDecisionReason` (see
 * `plugins/writing/hooks/io.ts`'s `formatDecision`). Matching is scoped to the known writing-hook
 * reason text rather than "any error," so a stubbed network failure (this suite's fixtures fail
 * every `gh`/`glab` create call on purpose) or a `pull-request:validate-body` deny never counts.
 */
export function hookDenies(trace: string): number {
  let count = 0;
  for (const raw of trace.trim().split("\n")) {
    if (raw === "") continue;
    const line = User.safeParse(JSON.parse(raw));
    if (!line.success) continue;
    for (const block of line.data.message.content) {
      const result = ToolResultBlock.safeParse(block);
      if (!result.success || result.data.is_error !== true) continue;
      const text = blockText(result.data.content).replace(HARNESS_PREFIX, "");
      if (WRITING_DENY_MARKERS.some((marker) => text.includes(marker))) count++;
    }
  }
  return count;
}

/** Trope density per 1000 words, summed across every category `writing:scan` reports. */
export function tropeDensity(text: string): number {
  const report = scoreText(text, undefined);
  if (report.wordCount === 0) return 0;
  const hits = report.categories.reduce((sum, c) => sum + c.hits, 0);
  return hits / (report.wordCount / 1000);
}

export interface RunMetrics {
  tokens: TokenUsage | undefined;
  denies: number;
  density: number | undefined;
}

export type Runs = Map<string, RunMetrics[]>;

/** Every run of one case and arm, pooled across the results directories of a column. */
export async function loadRuns(
  results: string[],
  files = new Map<string, string>(),
): Promise<Runs> {
  const traces = results.flatMap((result) => {
    const dir = result.endsWith(".json") ? dirname(result) : result;
    const found = globSync("traces/*.jsonl", { cwd: dir }).map((t) => join(dir, t));
    if (found.length === 0) throw new Error(`No traces/*.jsonl in ${dir}`);
    return found;
  });
  const read = await Promise.all(traces.map(async (t) => [t, await Bun.file(t).text()] as const));

  const out: Runs = new Map();
  for (const [path, text] of read) {
    const match = /^(.+)-(with|without)-\d+\.jsonl$/.exec(basename(path));
    if (match === null) continue;
    const key = `${match[1]}/${match[2]}`;
    const draft = extractDeliverable(text, files.get(match[1] ?? ""));
    const metrics: RunMetrics = {
      tokens: tokenUsage(text),
      denies: hookDenies(text),
      density: draft === undefined ? undefined : tropeDensity(draft),
    };
    const cell = out.get(key) ?? [];
    cell.push(metrics);
    out.set(key, cell);
  }
  return out;
}

export interface RenderOptions {
  runs: Runs[];
  labels: string[];
  alpha: number;
  guardMultiplier: number;
  json?: boolean | undefined;
}

interface MetricSeries {
  key: string;
  /** One number array per provided column, in column order, undefined runs dropped. */
  columns: number[][];
}
interface MetricGroup {
  title: string;
  digits: number;
  series: MetricSeries[];
}

export interface JsonReport {
  sections: {
    title: string;
    rows: {
      key: string;
      values: { label: string; n: number; mean: number | undefined; starred: boolean }[];
    }[];
  }[];
  guard: { label: string; baseMean: number; mean: number; limit: number; pass: boolean }[];
}

const fmt = (xs: number[], digits: number): string =>
  xs.length > 0 ? mean(xs).toFixed(digits) : "-";

// Mirrors compare.ts's own `mark`/`row` helpers (not exported) over `pValue`/`pFloor`, which
// are exported and reused here rather than re-implemented.
function mark(base: number[], xs: number[], alpha: number): string {
  if (base.length === 0 || xs.length === 0) return "";
  if (pFloor(base.length, xs.length) >= alpha) return "†";
  return pValue(base, xs) < alpha ? "*" : "";
}

function present(xs: (number | undefined)[]): number[] {
  return xs.filter((x): x is number => x !== undefined);
}

function metricGroups(runs: Runs[]): MetricGroup[] {
  const keys = [...new Set(runs.flatMap((r) => [...r.keys()]))].toSorted();
  const pick = (get: (m: RunMetrics) => number | undefined): MetricSeries[] =>
    keys.map((key) => ({ key, columns: runs.map((r) => present((r.get(key) ?? []).map(get))) }));
  return [
    { title: "Total tokens", digits: 0, series: pick((m) => m.tokens?.total) },
    { title: "Output tokens", digits: 0, series: pick((m) => m.tokens?.output) },
    { title: "Hook denies", digits: 2, series: pick((m) => m.denies) },
    { title: "Trope density /1k", digits: 1, series: pick((m) => m.density) },
  ];
}

/** The cost guard: candidate mean total tokens per deliverable must be at most base * multiplier. */
function guard(runs: Runs[], labels: string[], guardMultiplier: number): JsonReport["guard"] {
  const pooled = runs.map((r) =>
    present([...r.values()].flatMap((cell) => cell.map((m) => m.tokens?.total))),
  );
  const [base = []] = pooled;
  const baseMean = base.length > 0 ? mean(base) : Number.NaN;
  return pooled.slice(1).map((xs, i) => {
    const candidateMean = xs.length > 0 ? mean(xs) : Number.NaN;
    const limit = baseMean * guardMultiplier;
    return {
      label: labels[i + 1] ?? `candidate${i}`,
      baseMean,
      mean: candidateMean,
      limit,
      pass: candidateMean <= limit,
    };
  });
}

function renderTable(groups: MetricGroup[], labels: string[], alpha: number): string[] {
  return groups.flatMap(({ title, digits, series }) => {
    const rows = series.map(({ key, columns }) => {
      const [base = [], ...rest] = columns;
      const cells = rest.map((xs) => `${fmt(xs, digits)}${mark(base, xs, alpha)}`);
      return [key, fmt(base, digits), ...cells];
    });
    return [title, table([["case/arm", ...labels], ...rows])];
  });
}

function seriesMean(xs: number[]): number | undefined {
  return xs.length > 0 ? mean(xs) : undefined;
}

function renderJson(
  groups: MetricGroup[],
  labels: string[],
  alpha: number,
): JsonReport["sections"] {
  return groups.map(({ title, series }) => ({
    title,
    rows: series.map(({ key, columns }) => {
      const [base = [], ...rest] = columns;
      const values = [
        { label: labels[0] ?? "base", n: base.length, mean: seriesMean(base), starred: false },
        ...rest.map((xs, i) => ({
          label: labels[i + 1] ?? `candidate${i}`,
          n: xs.length,
          mean: seriesMean(xs),
          starred: mark(base, xs, alpha) === "*",
        })),
      ];
      return { key, values };
    }),
  }));
}

export function render(options: RenderOptions): string {
  const { runs, labels, alpha, guardMultiplier } = options;
  const groups = metricGroups(runs);
  const guards = guard(runs, labels, guardMultiplier);

  if (options.json) {
    const report: JsonReport = { sections: renderJson(groups, labels, alpha), guard: guards };
    return JSON.stringify(report, null, 2);
  }

  const out = [
    `* marks p < ${alpha} against ${labels[0]} (permutation test, pooled runs). † marks a cell with too few runs on one side for any star.\n`,
    ...renderTable(groups, labels, alpha),
    `Cost guard (tokens per deliverable, pooled): candidate mean must be at most base mean × ${guardMultiplier}`,
    table([
      ["candidate", "base mean", "candidate mean", "limit", "verdict"],
      ...guards.map((g) => [
        g.label,
        g.baseMean.toFixed(0),
        g.mean.toFixed(0),
        g.limit.toFixed(0),
        g.pass ? "pass" : "fail",
      ]),
    ]),
  ];
  return out.join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "metrics.ts",
    parameters: ["<columns...>"],
    flags: {
      alpha: {
        type: Number,
        default: 0.1,
        description: "Star a cell whose permutation p-value against the baseline is below this",
      },
      label: {
        type: [String],
        description: "Label for each column in order, defaulting to the first result's directory",
      },
      guardMultiplier: {
        type: Number,
        default: 1.1,
        description: "Cost-guard ceiling: a candidate's mean total tokens over base's",
      },
      json: { type: Boolean, description: "Print the report as JSON" },
      file: {
        type: [String],
        default: [],
        description:
          "case=path: read the deliverable from the last Write/Edit to this file instead of the reply's <out> block",
      },
    },
    help: {
      description:
        "Report tokens per deliverable, writing-hook denies, and deliverable trope density per case and arm. Each column is one or more results directories (or aggregate-result.json paths), comma-joined. The first column is the baseline.",
    },
  });
  const paths = argv._.columns.map((c) => c.split(","));
  console.log(
    render({
      runs: await Promise.all(paths.map((p) => loadRuns(p, parseMap(argv.flags.file)))),
      labels: paths.map((p, i) => argv.flags.label[i] ?? basename(dirname(p[0] ?? ""))),
      alpha: argv.flags.alpha,
      guardMultiplier: argv.flags.guardMultiplier,
      json: argv.flags.json,
    }),
  );
}
