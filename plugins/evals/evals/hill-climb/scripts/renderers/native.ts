import { render } from "../../../../../../packages/evals/compare";
import { ALPHA, column } from "../block";
import type { Renderer } from ".";

/** The `compare.ts --markdown` report for a block, as the command prints it. */
export const native: Renderer = {
  runner: "native `claude plugin eval`",
  render(e, b, results) {
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
  },
};
