export interface BoardPull {
  readonly ref: string;
  readonly number: number;
  readonly state: "open" | "draft" | "merged";
}

export interface BoardRow {
  readonly kind: "worktree" | "pane";
  readonly pane: string | null;
  readonly agent: string | null;
  readonly owner: string;
  readonly repo: string;
  readonly slug: string;
  readonly forkOf: string | null;
  readonly ownedByViewer: boolean;
  readonly repoLabel: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly worktree: string | null;
  readonly pull: BoardPull | null;
  readonly prColumn: string;
  readonly age: number | null;
  readonly flags: readonly string[];
}

export const COLUMNS = [
  { header: "PANE", width: 9 },
  { header: "AGENT", width: 14 },
  { header: "REPO", width: 24 },
  { header: "BRANCH", width: 26 },
  { header: "PR", width: 13 },
  { header: "AGE", width: 4 },
  { header: "FLAGS", width: null },
] as const;

export function fit(value: string, width: number): string {
  // oxlint-disable-next-line unicorn/prefer-spread -- typescript/no-misused-spread rejects the spread form on a string.
  const points = Array.from(value);
  if (points.length <= width) return value;
  return `${points.slice(0, width - 1).join("")}…`;
}

export function branchLabel(row: Pick<BoardRow, "branch" | "detached" | "kind">): string {
  if (row.kind === "pane") return "-";
  if (row.branch !== null) return row.branch;
  return "(detached)";
}

export function rowCells(row: BoardRow): string[] {
  return [
    row.pane ?? "-",
    row.agent ?? "-",
    row.repoLabel,
    branchLabel(row),
    row.prColumn,
    row.age === null ? (row.kind === "pane" ? "-" : "?") : String(row.age),
    row.flags.join(","),
  ];
}

export function renderTable(rows: readonly (readonly string[])[]): string {
  const format = (cells: readonly string[], truncate: boolean): string =>
    COLUMNS.map((column, index) => {
      const raw = cells[index] ?? "";
      if (column.width === null) return raw;
      const value = truncate ? fit(raw, column.width) : raw;
      return value.padEnd(column.width);
    })
      .join(" ")
      .replace(/\s+$/, "");

  return [
    format(
      COLUMNS.map((column) => column.header),
      false,
    ),
    ...rows.map((cells) => format(cells, true)),
  ].join("\n");
}

export function renderBoard(rows: readonly BoardRow[]): string {
  return renderTable(rows.map(rowCells));
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function sortWorktreeRows(rows: readonly BoardRow[]): BoardRow[] {
  return rows.toSorted((left, right) => {
    const byRepo = compare(left.repo, right.repo);
    return byRepo === 0 ? compare(branchLabel(left), branchLabel(right)) : byRepo;
  });
}

export function jsonRow(row: BoardRow): Record<string, unknown> {
  return {
    kind: row.kind,
    pane: row.pane,
    agent: row.agent,
    owner: row.owner,
    repo: row.repo,
    slug: row.slug,
    forkOf: row.forkOf,
    ownedByViewer: row.ownedByViewer,
    branch: row.branch,
    detached: row.detached,
    worktree: row.worktree,
    pr: row.pull,
    prColumn: row.prColumn,
    age: row.age,
    flags: [...row.flags],
  };
}
