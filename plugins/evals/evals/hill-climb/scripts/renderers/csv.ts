import { ARMS, average, type Block, graderP, p3 } from "../block";
import type { Renderer } from ".";

function counts(b: Block, which: "base" | "cand"): string[] {
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
        `${c.id},${arm},seconds,${s.runs},${average(s.seconds).toFixed(1)}`,
        `${c.id},${arm},cost,${s.runs},${average(s.cost).toFixed(3)}`,
      ];
    }),
  );
  return ["case,arm,grader,runs,passes", ...rows, "", "case,arm,measure,runs,mean", ...measures];
}

/** Plain `case,arm,grader,runs,passes` lines for each column, then a p-value table. */
export const csv: Renderer = {
  runner: "a custom runner that writes per-grader run and pass counts as CSV",
  render(_, b) {
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
    const body = [
      `# ${b.labels[0]}`,
      ...counts(b, "base"),
      "",
      `# ${b.labels[1]}`,
      ...counts(b, "cand"),
      "",
      `# permutation p-values, ${b.labels[1]} against ${b.labels[0]}, two-sided`,
      "case,arm,name,p",
      ...ps,
    ];
    return ["```", ...body, "```"].join("\n");
  },
};
