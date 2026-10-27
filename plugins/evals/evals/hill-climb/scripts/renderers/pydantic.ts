import { table } from "table";
import { ARMS, average, type Block, type BlockCase, graderP, p3 } from "../block";
import type { Renderer } from ".";

const pct = (passes: number, runs: number) => `${Math.round((passes / runs) * 100)}%`;

const delta = (b: number, c: number) => {
  const d = Math.round((c - b) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
};

function rows(c: BlockCase): string[][] {
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
      `${average(base.seconds).toFixed(1)}s → ${average(cand.seconds).toFixed(1)}s`,
      `$${average(base.cost).toFixed(3)} → $${average(cand.cost).toFixed(3)}`,
      stats.join("\n"),
    ];
  });
}

/** A text table in the style of pydantic-evals `report.render(baseline=...)`. */
export const pydantic: Renderer = {
  runner: "pydantic-evals, diffed with `report.render(baseline=...)`",
  render(_, b: Block) {
    const head = ["Case ID", "Assertions", "Duration", "Cost", "Runs and permutation p-value"];
    const failures = b.cases
      .filter((c) => c.errored > 0)
      .flatMap((c) =>
        ARMS.map((arm) => `${c.id} (${arm}): ${c.errored} runs errored, session limit`),
      );
    const body = [
      `Evaluation Diff: ${b.labels[0]} → ${b.labels[1]}`,
      table([head, ...b.cases.flatMap(rows)]),
      "p-values are two-sided permutation tests of the candidate runs against the baseline runs.",
      ...(failures.length > 0 ? ["", "Case Failures", ...failures.map((f) => `- ${f}`)] : []),
    ];
    return ["```", ...body, "```"].join("\n");
  },
};
