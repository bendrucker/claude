#!/usr/bin/env bun
import { basename, dirname } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { mean } from "simple-statistics";
import { table } from "table";
import { z } from "zod";
import { legend, mark } from "../../../../../packages/evals/compare";
import { listTraces } from "../../../../../packages/evals/layout";
import { type TokenUsage, traceUsage } from "../../../../../packages/evals/trace";
import { scoreText } from "../../../skills/scan/scripts/score";
import { extractDeliverable, parseMap } from "./pairwise";

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

// Text a writing-hook deny reason carries. A deny lists several findings under `report.ts`'s
// header, or carries one Vale error-level message alone. Hand-maintained, since the hook builds
// its reason at runtime.
export const WRITING_DENY_MARKERS = ["Writing checks found", "are an AI writing tell"];

// Since 2026-09-19 the harness prepends this before a PreToolUse deny's reason reaches the
// denied call's tool_result. Stripping it is not required for the substring match above, but
// keeps `reason` comparable to the hook's own source text.
const HARNESS_PREFIX = /^\s*PreToolUse:\w+ hook error:\s*/;

/**
 * Count of writing-hook denies in a trace. A PreToolUse hook returning `permissionDecision:
 * "deny"` writes no separate hook record: the surviving trace is a `tool_result` with
 * `is_error: true` whose content is the hook's `permissionDecisionReason`. Matching is scoped to
 * the known writing-hook reason text rather than "any error," so a stubbed network failure
 * (this suite's fixtures fail every `gh`/`glab` create call on purpose) or a
 * `pull-request:validate-body` deny never counts.
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

/** Trope density per 1000 words. */
export async function tropeDensity(text: string): Promise<number> {
  const report = await scoreText(text);
  if (report.wordCount === 0) return 0;
  const hits = report.checks.reduce((sum, c) => sum + c.hits, 0);
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
    const found = listTraces(dir);
    if (found.length === 0) throw new Error(`No traces/*.jsonl in ${dir}`);
    return found;
  });
  const read = await Promise.all(
    traces.map(async (t) => [t, await Bun.file(t.path).text()] as const),
  );

  const measured = await Promise.all(
    read.map(async ([ref, text]) => {
      if (ref.arm !== "with" && ref.arm !== "without") return undefined;
      const draft = extractDeliverable(text, files.get(ref.case));
      const metrics: RunMetrics = {
        tokens: traceUsage(text),
        denies: hookDenies(text),
        density: draft === undefined ? undefined : await tropeDensity(draft),
      };
      return { key: `${ref.case}/${ref.arm}`, metrics };
    }),
  );

  const out: Runs = new Map();
  for (const run of measured) {
    if (run === undefined) continue;
    const { key, metrics } = run;
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
          starred: mark(base, xs, alpha).endsWith("*"),
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
    `${legend(labels[0] ?? "base", alpha)} Runs pool across a column's results directories.\n`,
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

function float(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("metrics.ts")
  .description(
    "Report tokens per deliverable, writing-hook denies, and deliverable trope density per case and arm. Each column is one or more results directories (or aggregate-result.json paths), comma-joined. The first column is the baseline.",
  )
  .argument("<columns...>", "results directories or aggregate-result.json paths, comma-joined")
  .option(
    "--alpha <p>",
    "Star a cell whose permutation p-value against the baseline is below this",
    float,
    0.1,
  )
  .option(
    "--label <name>",
    "Label for each column in order, defaulting to the first result's directory",
    collect,
    [],
  )
  .option(
    "--guard-multiplier <x>",
    "Cost-guard ceiling: a candidate's mean total tokens over base's",
    float,
    1.1,
  )
  .option("--json", "Print the report as JSON")
  .option(
    "--file <case=path>",
    "case=path: read the deliverable from the last Write/Edit to this file instead of the reply's <out> block",
    collect,
    [],
  )
  .action(async (columns, options) => {
    const paths = columns.map((c) => c.split(","));
    console.log(
      render({
        runs: await Promise.all(paths.map((p) => loadRuns(p, parseMap(options.file)))),
        labels: paths.map((p, i) => options.label[i] ?? basename(dirname(p[0] ?? ""))),
        alpha: options.alpha,
        guardMultiplier: options.guardMultiplier,
        json: options.json ?? false,
      }),
    );
  });

if (import.meta.main) await program.parseAsync();
