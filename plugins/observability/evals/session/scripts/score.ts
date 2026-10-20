#!/usr/bin/env bun
import { globSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { table } from "table";
import { z } from "zod";
import { mean } from "simple-statistics";
import { traceReply } from "../../../../../packages/evals/trace";
import { statements } from "../../bench/sql";

const SUITE = join(import.meta.dirname, "..");

export const TruthRow = z.object({ key: z.string().nullish(), value: z.number().nullish() });
export type TruthRow = z.output<typeof TruthRow>;

export interface Truth {
  rows: TruthRow[];
  /** Relative error a value may carry and still match, from a `-- tolerance:` header. */
  tolerance: number;
  /** Paths or commands that show the session opened the right reference, from `-- reference:`. */
  reference?: RegExp;
}

function header(sql: string, name: string): string | undefined {
  return new RegExp(`^--\\s*${name}:\\s*(.+)$`, "m").exec(sql)?.[1]?.trim();
}

/** Runs a case's `truth.sql` after the shared prelude, read-only, against the frozen index. */
export async function loadTruth(caseDir: string, index: string): Promise<Truth> {
  const sql = await Bun.file(join(caseDir, "truth.sql")).text();
  const prelude = await Bun.file(join(SUITE, "prelude.sql")).text();
  const out =
    await $`duckdb -readonly -json -init ${join(SUITE, "../../skills/session/resources/limits.sql")} ${index} -c ${prelude + sql}`.text();
  const tolerance = Number(header(sql, "tolerance") ?? 0);
  const reference = header(sql, "reference");
  const rows = z.array(TruthRow).parse(JSON.parse(out.trim() === "" ? "[]" : out));
  return reference === undefined
    ? { rows, tolerance }
    : { rows, tolerance, reference: new RegExp(reference) };
}

// Dates and times read as numbers otherwise, and a count never takes their shape.
const DATE = /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g;
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;
// A list item or table row, which is where a reply states one answer per line. A reply
// with a table puts its answer there and its notes in the list, so then only rows count.
const ITEM = /^\s*(?:[-*+]|\d+[.)]|\|)/;
const ROW = /^\s*\|/;
const SESSION = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function numbers(line: string): number[] {
  return [...line.replaceAll(DATE, " ").matchAll(NUMBER)].map((m) =>
    Number(m[0].replaceAll(",", "")),
  );
}

function matches(line: string, row: TruthRow, tolerance: number): boolean {
  if (row.key != null && !line.toLowerCase().includes(row.key.toLowerCase())) return false;
  if (row.value == null) return true;
  const want = row.value;
  return numbers(line).some((n) => Math.abs(n - want) <= tolerance * Math.max(1, Math.abs(want)));
}

/**
 * Recall is the share of truth rows some reply line states, key and value together. Precision is
 * the share of the reply's answer lines (list items and table rows carrying a number) that state a
 * truth row, or, when the truth is a set of sessions, the share of the sessions the reply names
 * that are in it. A scalar answer has no list to be precise over, so its precision is its recall.
 */
export function overlap(reply: string, truth: Truth): { recall: number; precision: number } {
  const lines = reply.split("\n");
  const hit = truth.rows.filter((row) => lines.some((l) => matches(l, row, truth.tolerance)));
  const recall = truth.rows.length === 0 ? 1 : hit.length / truth.rows.length;
  const ids = truth.rows.map((row) => (row.value == null ? row.key?.toLowerCase() : undefined));
  if (ids.length > 0 && ids.every((k) => k?.replace(SESSION, "") === "")) {
    const named = new Set(reply.toLowerCase().match(SESSION));
    if (named.size === 0) return { recall, precision: recall };
    return { recall, precision: [...named].filter((s) => ids.includes(s)).length / named.size };
  }
  const keyed = truth.rows.some((row) => row.key != null);
  const answers = lines.filter((l) => ITEM.test(l) && numbers(l).length > 0);
  const rows = answers.filter((l) => ROW.test(l));
  const items = rows.length > 0 ? rows : answers;
  if (!keyed || items.length === 0) return { recall, precision: recall };
  const right = items.filter((l) => truth.rows.some((row) => matches(l, row, truth.tolerance)));
  return { recall, precision: right.length / items.length };
}

const Block = z.looseObject({ type: z.string() });
const Line = z.looseObject({
  type: z.string(),
  // A system notice such as permission_denied carries its message as a string.
  message: z
    .union([z.object({ content: z.union([z.string(), z.array(Block)]) }), z.string()])
    .optional(),
  usage: z.record(z.string(), z.unknown()).nullish(),
  duration_ms: z.number().nullish(),
});
const Use = z.object({
  id: z.string(),
  name: z.string(),
  input: z.looseObject({ command: z.string().optional(), file_path: z.string().optional() }),
});
const Result = z.object({
  tool_use_id: z.string(),
  content: z.unknown(),
  is_error: z.boolean().nullish(),
});
// DuckDB names its error class, and the CLI can print one and still exit 0.
const SQL_ERROR = /\b(?:Binder|Parser|Catalog|Conversion|Invalid Input|Out of Memory|IO) Error\b/;

export interface Process {
  tokens: number;
  seconds: number;
  queries: number;
  errors: number;
  reference: boolean;
}

/** What a trace shows about how the session got its answer. */
export function processOf(trace: string, reference?: RegExp): Process {
  const lines = trace
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => Line.parse(JSON.parse(l)));
  const blocks = lines.flatMap((l) =>
    typeof l.message === "object" && Array.isArray(l.message.content) ? l.message.content : [],
  );
  const uses = blocks.flatMap((b) => (b.type === "tool_use" ? [Use.parse(b)] : []));
  const sql = new Map(
    uses.flatMap((u) => {
      const sent = u.name === "Bash" ? statements(u.input.command ?? "") : [];
      return sent.length > 0 ? [[u.id, sent.length] as const] : [];
    }),
  );
  const errors = blocks.filter((b) => {
    if (b.type !== "tool_result") return false;
    const r = Result.parse(b);
    return (
      sql.has(r.tool_use_id) && (r.is_error === true || SQL_ERROR.test(JSON.stringify(r.content)))
    );
  }).length;
  const opened = uses.some((u) => reference?.test(u.input.file_path ?? u.input.command ?? ""));
  const last = lines.findLast((l) => l.type === "result");
  const usage = Object.values(last?.usage ?? {}).filter((v): v is number => typeof v === "number");
  return {
    tokens: usage.reduce((a, b) => a + b, 0),
    seconds: (last?.duration_ms ?? 0) / 1000,
    queries: [...sql.values()].reduce((a, b) => a + b, 0),
    errors,
    reference: reference === undefined || opened,
  };
}

export interface Scored extends Process {
  case: string;
  arm: string;
  recall: number;
  precision: number;
}

const TRACE = /^(.+)-([^-]+)-(\d+)\.jsonl$/;

/** Scores every trace under `<results>/traces/` whose case carries a `truth.sql`. */
export async function scoreResults(results: string, index: string): Promise<Scored[]> {
  const truths = new Map<string, Promise<Truth>>();
  const runs = globSync("traces/*.jsonl", { cwd: results }).map(async (file) => {
    const [, name = "", arm = ""] = TRACE.exec(basename(file)) ?? [];
    const dir = join(SUITE, name);
    if (!(await Bun.file(join(dir, "truth.sql")).exists())) return [];
    const pending = truths.get(name) ?? loadTruth(dir, index);
    truths.set(name, pending);
    const truth = await pending;
    const trace = await Bun.file(join(results, file)).text();
    return [
      {
        case: name,
        arm,
        ...overlap(traceReply(trace) ?? "", truth),
        ...processOf(trace, truth.reference),
      },
    ];
  });
  return (await Promise.all(runs)).flat();
}

const COLUMNS = [
  "recall",
  "precision",
  "tokens",
  "seconds",
  "queries",
  "errors",
  "reference",
] as const;

export const program = new Command("score.ts")
  .description(
    "Score session eval runs against each case's truth.sql on the frozen index: precision and recall of the reply, plus tokens, seconds, queries, SQL errors, and whether the session opened the case's reference. Writes <results>/scored.json.",
  )
  .argument("<results...>", "results directories holding traces/")
  .option("--index <path>", "the frozen index the runs read", join(SUITE, "data", "session.duckdb"))
  .action(async (results, options) => {
    const all = await Promise.all(
      results.map(async (dir) => {
        const scored = await scoreResults(dir, options.index);
        await Bun.write(join(dir, "scored.json"), `${JSON.stringify(scored, null, 2)}\n`);
        return scored;
      }),
    );
    for (const scored of all) {
      const groups = Map.groupBy(scored, (s) => `${s.case} ${s.arm}`);
      const rows = [...groups]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, runs]) => {
          const cells = [key, String(runs.length)];
          for (const c of COLUMNS)
            cells.push(mean(runs.map((r) => Number(r[c]))).toFixed(c === "tokens" ? 0 : 2));
          return cells;
        });
      console.log(table([["case arm", "runs", ...COLUMNS], ...rows]));
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
