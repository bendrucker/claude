import { table } from "table";
import { render } from "../../../../../packages/evals/compare";
import { pValue } from "../../../../../packages/evals/stats";
import {
  ALPHA,
  ARMS,
  type Block,
  type BlockCase,
  column,
  type Evidence,
  flags,
  type Side,
} from "./evidence";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const p3 = (base: number[], cand: number[]) => pValue(base, cand).toFixed(3);

const graderP = (b: Side, c: Side, g: string) =>
  p3(flags(b.runs, b.passes[g] ?? 0).map(Number), flags(c.runs, c.passes[g] ?? 0).map(Number));

/** The `compare.ts --markdown` report for a block, as the command prints it. */
function native(e: Evidence, b: Block, results: [base: string, cand: string]): string {
  const tags = new Map(b.cases.map((c) => [c.id, [c.split]] as [string, string[]]));
  const report = render({
    columns: [column(b, "base"), column(b, "cand")],
    labels: b.labels,
    alpha: ALPHA,
    tags,
    markdown: true,
  });
  const command = [
    "bun evals/native/compare.ts",
    `--suite ${e.domain.suite}`,
    "--markdown",
    `--label ${b.labels[0]} --label ${b.labels[1]}`,
    results[0],
    results[1],
  ].join(" ");
  return ["```", `$ ${command}`, "```", "", "`````markdown", report, "`````"].join("\n");
}

const pct = (passes: number, runs: number) => `${Math.round((passes / runs) * 100)}%`;

const delta = (b: number, c: number) => {
  const d = Math.round((c - b) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
};

function pydanticRows(c: BlockCase): string[][] {
  return ARMS.map((arm) => {
    const base = c.base[arm];
    const cand = c.cand[arm];
    const rate = (g: string) => {
      const b = (base.passes[g] ?? 0) / base.runs;
      const x = (cand.passes[g] ?? 0) / cand.runs;
      return `${g}: ${pct(base.passes[g] ?? 0, base.runs)} → ${pct(cand.passes[g] ?? 0, cand.runs)} (${delta(b, x)})`;
    };
    const stats = [
      ...c.graders.map(
        (g) => `${g}: ${base.runs} → ${cand.runs} runs, p=${graderP(base, cand, g)}`,
      ),
      `duration: p=${p3(base.seconds, cand.seconds)}`,
      `cost: p=${p3(base.cost, cand.cost)}`,
    ];
    return [
      `${c.id} (${arm})`,
      c.graders.map(rate).join("\n"),
      `${mean(base.seconds).toFixed(1)}s → ${mean(cand.seconds).toFixed(1)}s`,
      `$${mean(base.cost).toFixed(3)} → $${mean(cand.cost).toFixed(3)}`,
      stats.join("\n"),
    ];
  });
}

/** A text table in the style of pydantic-evals `report.render(baseline=...)`. */
function pydantic(b: Block): string {
  const head = ["Case ID", "Assertions", "Duration", "Cost", "Runs and permutation p-value"];
  const failures = b.cases
    .filter((c) => c.errored > 0)
    .flatMap((c) =>
      ARMS.map((arm) => `${c.id} (${arm}): ${c.errored} runs errored, session limit`),
    );
  return [
    `Evaluation Diff: ${b.labels[0]} → ${b.labels[1]}`,
    table([head, ...b.cases.flatMap(pydanticRows)]),
    "p-values are two-sided permutation tests of the candidate runs against the baseline runs.",
    ...(failures.length > 0 ? ["", "Case Failures", ...failures.map((f) => `- ${f}`)] : []),
  ].join("\n");
}

function csvCounts(b: Block, which: "base" | "cand"): string[] {
  const rows = b.cases.flatMap((c) =>
    ARMS.flatMap((arm) => {
      const s = c[which][arm];
      return c.graders.map((g) => `${c.id},${arm},${g},${s.runs},${s.passes[g] ?? 0}`);
    }),
  );
  const measures = b.cases.flatMap((c) =>
    ARMS.flatMap((arm) => {
      const s = c[which][arm];
      return [
        `${c.id},${arm},seconds,${s.runs},${mean(s.seconds).toFixed(1)}`,
        `${c.id},${arm},cost,${s.runs},${mean(s.cost).toFixed(3)}`,
      ];
    }),
  );
  return ["case,arm,grader,runs,passes", ...rows, "", "case,arm,measure,runs,mean", ...measures];
}

/** Plain `case,arm,grader,runs,passes` lines for each column, then a p-value table. */
function csv(b: Block): string {
  const ps = b.cases.flatMap((c) =>
    ARMS.flatMap((arm) => {
      const base = c.base[arm];
      const cand = c.cand[arm];
      const lines = c.graders.map((g) => `${c.id},${arm},${g},${graderP(base, cand, g)}`);
      lines.push(
        `${c.id},${arm},seconds,${p3(base.seconds, cand.seconds)}`,
        `${c.id},${arm},cost,${p3(base.cost, cand.cost)}`,
      );
      return lines;
    }),
  );
  return [
    `# ${b.labels[0]}`,
    ...csvCounts(b, "base"),
    "",
    `# ${b.labels[1]}`,
    ...csvCounts(b, "cand"),
    "",
    `# permutation p-values, ${b.labels[1]} against ${b.labels[0]}, two-sided`,
    "case,arm,name,p",
    ...ps,
  ].join("\n");
}

/** One block of comparison output as the case's harness prints it. */
export function renderBlock(e: Evidence, b: Block, results: [string, string]): string {
  if (e.harness === "native") return native(e, b, results);
  return ["```", e.harness === "pydantic" ? pydantic(b) : csv(b), "```"].join("\n");
}
