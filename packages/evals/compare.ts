import { mean, min } from "simple-statistics";
import { table } from "table";
import type { Cell, Column } from "./column";
import { pFloor, pValue } from "./stats";
import { type Measure, measures } from "./trace";

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

/**
 * A cell's p-value against the baseline and its mark: `*` when it moved, `†` when too few runs
 * could ever star it.
 */
function mark(base: number[], xs: number[], alpha: number): string {
  if (base.length === 0 || xs.length === 0) return "";
  const p = pValue(base, xs);
  if (pFloor(base.length, xs.length) >= alpha) return ` (p=${p.toFixed(2)})†`;
  return ` (p=${p.toFixed(3)})${p < alpha ? "*" : ""}`;
}

const ARMS = ["with", "without"];

/** Every case's runs on one arm, pooled, so a suite-wide shift can star where no case can. */
function poolArm(columns: Column[], keys: string[], arm: string, pick: (cell: Cell) => number[]) {
  return columns.map((c) =>
    keys
      .filter((key) => key.endsWith(`/${arm}`))
      .flatMap((key) => {
        const cell = c.get(key);
        return cell === undefined ? [] : pick(cell);
      }),
  );
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
  const poolRows = (pick: (cell: Cell) => number[], prefix: string[] = []) =>
    ARMS.filter((arm) => keys.some((key) => key.endsWith(`/${arm}`))).map((arm) =>
      row([`all/${arm}`, ...prefix], poolArm(columns, keys, arm, pick), 2),
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

  const graderNames = new Set<string>();
  for (const column of columns) {
    for (const cell of column.values())
      for (const name of cell.graders.keys()) graderNames.add(name);
  }
  const graderPoolRows =
    keys.length > 1
      ? [...graderNames]
          .toSorted()
          .flatMap((name) => poolRows((c) => (c.graders.get(name) ?? []).map(Number), [name]))
      : [];
  const result: Section[] = [
    [
      "Case score",
      ["case/arm"],
      keys.length > 1 ? [...poolRows((c) => c.scores), ...scoreRows] : scoreRows,
    ],
    ["Case minimum", ["case/arm"], minRows],
    ...measureSections,
    ["Grader pass rate", ["case/arm", "grader"], [...graderPoolRows, ...graderRows]],
  ];
  if (tags !== undefined) {
    const names = [...new Set([...tags.values()].flat())].toSorted();
    const tagRows = ARMS.flatMap((arm) =>
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
        `Each cell shows its two-sided permutation p-value against ${labels[0]}, and * marks p < ${alpha}. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.\n`,
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
