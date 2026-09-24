#!/usr/bin/env bun
import { basename, dirname } from "node:path";
import { cli } from "cleye";
import seedrandom from "seedrandom";
import { mean, permutationTest } from "simple-statistics";
import { table } from "table";
import { type Column, loadColumn, loadTags } from "./results";

const argv = cli({
  name: "compare.ts",
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
    suite: {
      type: String,
      description: "Suite directory whose case.yaml tags roll case scores up by tag",
    },
    markdown: {
      type: Boolean,
      description: "Print markdown with the starred rows first and the full tables collapsed",
    },
  },
  help: {
    description:
      "Compare native plugin eval results. Each column is one aggregate-result.json, or several joined by commas whose runs pool into one column. The first column is the baseline.",
  },
});

const fmt = (xs: number[], digits: number) => (xs.length > 0 ? mean(xs).toFixed(digits) : "-");

function pValue(base: number[], other: number[]): number {
  if (base.length === 0 || other.length === 0) return NaN;
  if (new Set([...base, ...other]).size === 1) return 1;
  return permutationTest(base, other, "two_side", 10_000, seedrandom("compare"));
}

/** One table row: the baseline mean, then each column's mean starred when it differs from the baseline. */
function row(prefix: string[], series: number[][], digits: number): string[] {
  const [base = [], ...rest] = series;
  const cells = rest.map(
    (xs) => `${fmt(xs, digits)}${pValue(base, xs) < argv.flags.alpha ? "*" : ""}`,
  );
  return [...prefix, fmt(base, digits), ...cells];
}

const columns: Column[] = await Promise.all(argv._.columns.map((c) => loadColumn(c.split(","))));
const labels = argv._.columns.map(
  (c, i) => argv.flags.label[i] ?? basename(dirname(c.split(",")[0] ?? c)),
);
const keys = [...new Set(columns.flatMap((c) => [...c.keys()]))].toSorted();

const scoreRows = keys.map((key) =>
  row(
    [key],
    columns.map((c) => c.get(key)?.scores ?? []),
    2,
  ),
);
const wordRows = keys.map((key) =>
  row(
    [key],
    columns.map((c) => c.get(key)?.words ?? []),
    0,
  ),
);
const graderRows = keys.flatMap((key) => {
  const names = new Set(columns.flatMap((c) => [...(c.get(key)?.graders.keys() ?? [])]));
  return [...names].toSorted().map((name) =>
    row(
      [key, name],
      columns.map((c) => (c.get(key)?.graders.get(name) ?? []).map(Number)),
      2,
    ),
  );
});

async function tagRows(suite: string): Promise<string[][]> {
  const tags = await loadTags(suite);
  const names = [...new Set([...tags.values()].flat())].toSorted();
  return ["with", "without"].flatMap((arm) =>
    names.map((tag) => {
      const cases = [...tags].filter(([, t]) => t.includes(tag)).map(([c]) => c);
      const series = columns.map((c) =>
        cases.flatMap((name) => c.get(`${name}/${arm}`)?.scores ?? []),
      );
      return row([`${tag}/${arm}`], series, 2);
    }),
  );
}

const sections: [string, string[], string[][]][] = [
  ["Case score", ["case/arm"], scoreRows],
  ["Reply words", ["case/arm"], wordRows],
  ["Grader pass rate", ["case/arm", "grader"], graderRows],
];
if (argv.flags.suite !== undefined)
  sections.unshift(["Tag score", ["tag/arm"], await tagRows(argv.flags.suite)]);

const starred = (r: string[]) => r.some((cell) => cell.endsWith("*"));
const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
const markdown = (head: string[], rows: string[][]) =>
  [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");

console.log(
  `* marks p < ${argv.flags.alpha} against ${labels[0]} (permutation test, pooled runs)\n`,
);
if (argv.flags.markdown) {
  const flagged = sections.flatMap(([title, head, rows]) =>
    rows.filter(starred).map((r) => {
      const cells = [title, r.slice(0, head.length).join(" · ")];
      cells.push(...r.slice(head.length));
      return cells;
    }),
  );
  console.log(
    flagged.length > 0
      ? markdown(["measure", "row", ...labels], flagged)
      : "No row moved past the noise rule.",
  );
  for (const [title, head, rows] of sections) {
    console.log(
      `\n<details><summary>${title}</summary>\n\n${markdown([...head, ...labels], rows)}\n\n</details>`,
    );
  }
} else {
  for (const [title, head, rows] of sections) {
    console.log(title);
    console.log(table([[...head, ...labels], ...rows]));
  }
}
