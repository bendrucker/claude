#!/usr/bin/env bun
import { basename, dirname } from "node:path";
import { cli } from "cleye";
import seedrandom from "seedrandom";
import { mean, min, permutationTest } from "simple-statistics";
import { table } from "table";
import { type Cell, type Column, loadColumn, loadTags, type Measure, measures } from "./load";

export interface RenderOptions {
  columns: Column[];
  labels: string[];
  alpha: number;
  /** Case name to tags, which adds a per-tag score section. */
  tags?: Map<string, string[]> | undefined;
  markdown?: boolean | undefined;
}

type Section = [title: string, head: string[], rows: string[][]];

const perRun: Record<Measure, [title: string, digits: number]> = {
  words: ["Reply words", 0],
  turns: ["Turns per run", 1],
  seconds: ["Seconds per run", 1],
  tokens: ["Output tokens per run", 0],
  cost: ["Cost per run (USD)", 3],
};

const fmt = (xs: number[], digits: number) => (xs.length > 0 ? mean(xs).toFixed(digits) : "-");

export function pValue(base: number[], other: number[]): number {
  if (base.length === 0 || other.length === 0) return NaN;
  if (new Set([...base, ...other]).size === 1) return 1;
  return permutationTest(base, other, "two_side", 10_000, seedrandom("compare"));
}

/**
 * The smallest p-value a permutation test can return for these sample sizes: one or two of the
 * C(n1 + n2, n1) splits, since equal sizes put the two extremes at the same distance.
 */
export function pFloor(n1: number, n2: number): number {
  let splits = 1;
  for (let i = 1; i <= Math.min(n1, n2); i++) splits = (splits * (n1 + n2 - i + 1)) / i;
  return (n1 === n2 ? 2 : 1) / splits;
}

/** A cell's mark: `*` when it moved, `†` when too few runs could ever star it. */
function mark(base: number[], xs: number[], alpha: number): string {
  if (base.length === 0 || xs.length === 0) return "";
  if (pFloor(base.length, xs.length) >= alpha) return "†";
  return pValue(base, xs) < alpha ? "*" : "";
}

function sections({ columns, alpha, tags }: RenderOptions): Section[] {
  /** The baseline mean, then each column's mean starred when it differs from the baseline. */
  const row = (prefix: string[], series: number[][], digits: number): string[] => {
    const [base = [], ...rest] = series;
    const cells = rest.map((xs) => `${fmt(xs, digits)}${mark(base, xs, alpha)}`);
    return [...prefix, fmt(base, digits), ...cells];
  };
  const series = (key: string, pick: (cell: Cell) => number[]) =>
    columns.map((c) => {
      const cell = c.get(key);
      return cell === undefined ? [] : pick(cell);
    });
  const keys = [...new Set(columns.flatMap((c) => [...c.keys()]))].toSorted();

  const dropped = (key: string) => columns.some((c) => (c.get(key)?.errored ?? 0) > 0);
  const scoreRows = keys.map((key) =>
    row(
      [dropped(key) ? `${key}!` : key],
      series(key, (c) => c.scores),
      2,
    ),
  );
  // A lone collapsed run drags a mean without starring it. The minimum shows it.
  const minRows = keys.map((key) => [
    key,
    ...series(key, (c) => c.scores).map((xs) => (xs.length > 0 ? min(xs).toFixed(2) : "-")),
  ]);
  const measureSections = measures.map((measure): Section => {
    const [title, digits] = perRun[measure];
    return [
      title,
      ["case/arm"],
      keys.map((key) =>
        row(
          [key],
          series(key, (c) => c[measure]),
          digits,
        ),
      ),
    ];
  });
  const graderRows = keys.flatMap((key) => {
    const names = new Set(columns.flatMap((c) => [...(c.get(key)?.graders.keys() ?? [])]));
    return [...names].toSorted().map((name) =>
      row(
        [key, name],
        series(key, (c) => (c.graders.get(name) ?? []).map(Number)),
        2,
      ),
    );
  });

  const result: Section[] = [
    ["Case score", ["case/arm"], scoreRows],
    ["Case minimum", ["case/arm"], minRows],
    ...measureSections,
    ["Grader pass rate", ["case/arm", "grader"], graderRows],
  ];
  if (tags !== undefined) {
    const names = [...new Set([...tags.values()].flat())].toSorted();
    const tagRows = ["with", "without"].flatMap((arm) =>
      names.map((tag) => {
        const cases = [...tags].filter(([, t]) => t.includes(tag)).map(([c]) => c);
        const pooled = columns.map((c) =>
          cases.flatMap((name) => c.get(`${name}/${arm}`)?.scores ?? []),
        );
        return row([`${tag}/${arm}`], pooled, 2);
      }),
    );
    result.unshift(["Tag score", ["tag/arm"], tagRows]);
  }
  return result;
}

const starred = (r: string[]) => r.some((cell) => cell.endsWith("*"));
const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
const markdown = (head: string[], rows: string[][]) =>
  [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");

/** Sections a single-column markdown report shows open rather than collapsed. */
const headline = new Set(["Tag score", "Case score"]);

/**
 * Renders the comparison report, as terminal tables or as markdown with starred rows first.
 * A single column has nothing to star, so it reports that run alone with its scores open.
 */
export function render(options: RenderOptions): string {
  const { labels, alpha } = options;
  const all = sections(options);
  const single = options.columns.length === 1;
  const out = single
    ? []
    : [
        `* marks p < ${alpha} against ${labels[0]} (permutation test, pooled runs). † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.\n`,
      ];
  if (!options.markdown) {
    for (const [title, head, rows] of all) out.push(title, table([[...head, ...labels], ...rows]));
    return out.join("\n");
  }

  if (single) {
    for (const [title, head, rows] of all) {
      const body = markdown([...head, ...labels], rows);
      out.push(
        headline.has(title)
          ? `### ${title}\n\n${body}\n`
          : `<details><summary>${title}</summary>\n\n${body}\n\n</details>\n`,
      );
    }
    return out.join("\n");
  }

  const flagged = all.flatMap(([title, head, rows]) =>
    rows.filter(starred).map((r) => {
      const cells = [title, r.slice(0, head.length).join(" · ")];
      cells.push(...r.slice(head.length));
      return cells;
    }),
  );
  out.push(
    flagged.length > 0
      ? markdown(["measure", "row", ...labels], flagged)
      : "No row moved past the noise rule.",
  );
  for (const [title, head, rows] of all) {
    out.push(
      `\n<details><summary>${title}</summary>\n\n${markdown([...head, ...labels], rows)}\n\n</details>`,
    );
  }
  return out.join("\n");
}

if (import.meta.main) {
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
        "Compare native plugin eval results. Each column is one aggregate-result.json, or several joined by commas whose runs pool into one column. The first column is the baseline, and a lone column reports that run without comparison.",
    },
  });
  const paths = argv._.columns.map((c) => c.split(","));
  console.log(
    render({
      columns: await Promise.all(paths.map(loadColumn)),
      labels: paths.map((p, i) => argv.flags.label[i] ?? basename(dirname(p[0] ?? ""))),
      alpha: argv.flags.alpha,
      tags: argv.flags.suite === undefined ? undefined : await loadTags(argv.flags.suite),
      markdown: argv.flags.markdown,
    }),
  );
}
