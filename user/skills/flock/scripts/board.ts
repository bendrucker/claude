import type { PullState } from "./forge";
import type { StatusRead } from "./worktree";

export interface BoardPull extends PullState {
  readonly ref: string;
  readonly number: number;
  readonly state: "open" | "draft" | "merged";
}

/**
 * Row state the table does not print but the sweep turns on. `flags` renders
 * most of it, and re-reading a disposition out of rendered strings would make
 * the classifier depend on how the board happens to spell them.
 */
export interface RowState {
  /** The pane running this flock. It sweeps everything except itself. */
  readonly self: boolean;
  /** An agent is mid-turn in the pane holding this worktree. */
  readonly working: boolean;
  /** An agent has stopped on a prompt only the user can answer. */
  readonly blocked: boolean;
  /** The forge refused to list pull requests, so no absence here is trustworthy. */
  readonly pullUnknown: boolean;
  /** What `git status` reported, so a checkout it could not read stays distinct. */
  readonly status: StatusRead;
  readonly unpushed: number | null;
  readonly carried: number;
  readonly mergedBranch: boolean;
  readonly reused: boolean;
}

/** Where a row lands in the sweep. `disposition.ts` decides which. */
export type Disposition =
  | "self"
  | "needs-you"
  | "merge"
  | "cleanup"
  | "waiting"
  | "working"
  | "parked"
  | "panes";

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
  readonly state: RowState;
  readonly disposition: Disposition;
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

/**
 * herdr rests an agent in `idle` or `done`, one state split by whether the tab
 * has been seen, so neither reports the work over: an agent between the turns
 * of a running workflow reads idle. The pane is occupied until the agent
 * leaves it. A shell is a person's prompt rather than an agent, and holds
 * nothing.
 */
export function heldByAgent(row: Pick<BoardRow, "agent">): boolean {
  return row.agent !== null && !row.agent.startsWith("shell/");
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

function format(cells: readonly string[], truncate: boolean): string {
  return COLUMNS.map((column, index) => {
    const raw = cells[index] ?? "";
    if (column.width === null) return raw;
    const value = truncate ? fit(raw, column.width) : raw;
    return value.padEnd(column.width);
  })
    .join(" ")
    .replace(/\s+$/, "");
}

export function headerRow(): string {
  return format(
    COLUMNS.map((column) => column.header),
    false,
  );
}

export function renderRows(rows: readonly (readonly string[])[]): string[] {
  return rows.map((cells) => format(cells, true));
}

export function renderTable(rows: readonly (readonly string[])[]): string {
  return [headerRow(), ...renderRows(rows)].join("\n");
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
    disposition: row.disposition,
    state: row.state,
  };
}
