import {
  branchLabel,
  fit,
  headerRow,
  heldByAgent,
  renderRows,
  rowCells,
  type BoardPull,
  type BoardRow,
  type Disposition,
} from "./board";
import type { PullState } from "./forge";

/**
 * What the row needs from the user, and whether the board spends a row on it.
 * The three rendered dispositions are the ones with an action attached. The
 * rest collapse to a count, because a row nobody can move is a row the user
 * reads and discards.
 */
export const RENDERED: readonly Disposition[] = ["needs-you", "merge", "cleanup"];

const COLLAPSED: readonly Disposition[] = ["waiting", "working", "parked", "panes"];

const LABELS: Record<Disposition, string> = {
  self: "self",
  "needs-you": "needs you",
  merge: "merge",
  cleanup: "clean up",
  waiting: "waiting",
  working: "working",
  parked: "parked",
  panes: "panes",
};

function openPull(row: BoardRow, pull: BoardPull): Disposition {
  // A draft is the author saying the work is not ready, so its red checks and
  // its stale base are expected rather than reportable.
  if (pull.state === "draft") return "waiting";

  // These three are the author's to fix wherever the pull request lives. A
  // conflicting branch in someone else's repository is still yours to rebase.
  if (pull.review === "changes-requested") return "needs-you";
  if (pull.mergeState === "conflicting") return "needs-you";
  if (pull.checks === "failing") return "needs-you";

  if (!row.ownedByViewer) return "waiting";
  if (pull.checks === "running") return "waiting";
  if (pull.checks === "passing" && pull.mergeState === "clean") return "merge";

  // Green but not mergeable, or a forge that would not say. Either way the bar
  // has to be read by hand, which cannot happen from a collapsed count.
  return "needs-you";
}

function settled(row: BoardRow): Disposition {
  const state = row.state;
  // Commits the merge did not take are the one thing here only the user can
  // rescue, and a recycled branch name means the merged pull request beside it
  // belongs to different work.
  if (state.unpushed === null || state.unpushed > 0) return "needs-you";
  if (state.reused) return "needs-you";
  // A detached checkout with nothing above the base has nothing to rescue, but
  // it has no branch to verify either, so it parks rather than being offered up.
  if (row.detached) return "parked";
  if (state.status === "dirty" || state.carried > 0) return "parked";
  return "cleanup";
}

function verdict(row: BoardRow): Disposition {
  // git could not read the checkout, so nothing else the row reports about it
  // is trustworthy, the same way an unlistable forge makes a missing pull
  // request untrustworthy.
  if (row.state.status === "unreadable") return "needs-you";

  const pull = row.pull;
  if (pull !== null && pull.state !== "merged") return openPull(row, pull);
  // A detached worktree has no branch to carry a pull request, so it reaches
  // `settled` on its own to have its unpushed commits counted.
  if (pull !== null || row.state.mergedBranch || row.detached) return settled(row);
  if (row.state.pullUnknown) return "needs-you";
  return "parked";
}

export function classify(row: BoardRow): Disposition {
  if (row.state.self) return "self";
  // herdr reports an agent stopped on a prompt as blocked, which is the one
  // pane state that is a question addressed to the user.
  if (row.state.blocked) return "needs-you";
  if (row.kind === "pane") return "panes";

  // An agent mid-turn owns the working tree, so nothing that touches the tree
  // is the user's to decide yet. A merge happens on the forge instead, and
  // holding it back would hide the one row the sweep exists to raise.
  const disposition = verdict(row);
  if (row.state.working) return disposition === "merge" ? disposition : "working";
  // A resting agent owns the tree too, and cleanup is the one disposition that
  // destroys it. Merge keeps its own path: an agent that finished the work
  // rests in the pane it finished in, so holding merges on an occupied pane
  // would empty the disposition rather than guard anything.
  return disposition === "cleanup" && heldByAgent(row) ? "working" : disposition;
}

const FAILING_SHOWN = 3;
const CHECK_NAME_WIDTH = 24;

function failingLabel(names: readonly string[]): string {
  if (names.length === 0) return "failing";
  const shown = names.slice(0, FAILING_SHOWN).map((name) => fit(name, CHECK_NAME_WIDTH));
  const rest = names.length - shown.length;
  return `failing:${shown.join(",")}${rest > 0 ? `+${rest}` : ""}`;
}

/**
 * Forge state rendered as flags, so the reason a row needs the user rides in
 * the column that already carries why a row is held.
 */
export function pullFlags(pull: PullState & { state: string }): string[] {
  if (pull.state === "merged" || pull.state === "draft") return [];
  const flags: string[] = [];

  const settledChecks = pull.checks !== "failing" && pull.checks !== "running";
  if (pull.checks === "failing") flags.push(failingLabel(pull.failing));
  else if (pull.checks === "running") flags.push("running");
  else if (pull.checks === "unknown") flags.push("checks:?");
  else if (pull.checks === "none") flags.push("checks:none");

  const gate = pull.mergeState;
  if (gate === "conflicting" || gate === "behind") flags.push(gate);
  // A blocked or unstable merge state restates a check that has not settled,
  // and saying it twice buries the job name that makes the row actionable.
  else if (settledChecks && (gate === "blocked" || gate === "unstable")) flags.push(gate);

  if (pull.review === "changes-requested" || pull.review === "approved") flags.push(pull.review);
  return flags;
}

export type Groups = ReadonlyMap<Disposition, readonly BoardRow[]>;

export function groupByDisposition(rows: readonly BoardRow[]): Groups {
  const groups = new Map<Disposition, BoardRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.disposition);
    if (bucket === undefined) groups.set(row.disposition, [row]);
    else bucket.push(row);
  }
  return groups;
}

function of(groups: Groups, disposition: Disposition): readonly BoardRow[] {
  return groups.get(disposition) ?? [];
}

export function countLine(groups: Groups): string {
  const counts = [...RENDERED, ...COLLAPSED]
    .map((disposition) => ({ disposition, count: of(groups, disposition).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${LABELS[entry.disposition]} ${entry.count}`);
  return counts.length === 0 ? "nothing on the board" : counts.join(" · ");
}

/**
 * The rendered dispositions share one header, and a flush-left label opens
 * each group, so a section costs one line rather than a repeated header. The
 * label bypasses the column formatter, which would pad and truncate it.
 */
export function renderSections(groups: Groups): string[] {
  const present = RENDERED.filter((disposition) => of(groups, disposition).length > 0);
  if (present.length === 0) return [];

  const lines = [headerRow()];
  for (const disposition of present) {
    lines.push(LABELS[disposition], ...renderRows(of(groups, disposition).map(rowCells)));
  }
  return lines;
}

/**
 * A waiting row that is green and not yours is waiting on the maintainer to
 * merge it, so calling that "review" asks for a review already given.
 */
function waitingReason(pull: BoardPull): string {
  if (pull.state === "draft") return "draft";
  if (pull.checks === "running") return "ci";
  return pull.review === "review-required" ? "review" : "merge";
}

/** What a waiting row is waiting on, so the next question can name it. */
function waitingEntry(row: BoardRow): string {
  const pull = row.pull;
  if (pull === null) return `${row.repoLabel}/${branchLabel(row)}`;
  const reason = waitingReason(pull);
  return `${row.repoLabel}#${pull.number} ${reason}`;
}

function paneLabel(row: BoardRow): string {
  return `${row.pane ?? "-"} ${row.agent ?? "-"}`;
}

function byRepo(rows: readonly BoardRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.repoLabel, (counts.get(row.repoLabel) ?? 0) + 1);
  return [...counts]
    .toSorted(([leftRepo, left], [rightRepo, right]) =>
      left === right ? leftRepo.localeCompare(rightRepo) : right - left,
    )
    .map(([repo, count]) => `${repo} ${count}`);
}

function line(
  groups: Groups,
  disposition: Disposition,
  entries: (rows: readonly BoardRow[]) => string[],
): string[] {
  const rows = of(groups, disposition);
  if (rows.length === 0) return [];
  return [`${LABELS[disposition]} ${rows.length}: ${entries(rows).join(" · ")}`];
}

/**
 * One line per collapsed disposition. Waiting and panes keep their identities,
 * because the next question about either names a specific pull request or a
 * specific pane. Parked keeps repository counts only: nothing in it has a
 * pending action to attach a name to.
 */
export function collapsedLines(groups: Groups): string[] {
  return [
    ...line(groups, "waiting", (rows) => rows.map(waitingEntry)),
    ...line(groups, "working", (rows) => rows.map((row) => `${row.repoLabel}/${branchLabel(row)}`)),
    ...line(groups, "parked", byRepo),
    ...line(groups, "panes", (rows) => rows.map(paneLabel)),
  ];
}

export function renderBoard(rows: readonly BoardRow[]): string {
  const groups = groupByDisposition(rows);
  const sections = renderSections(groups);
  const collapsed = collapsedLines(groups);
  return [
    countLine(groups),
    ...(sections.length === 0 ? [] : ["", ...sections]),
    ...(collapsed.length === 0 ? [] : ["", ...collapsed]),
  ].join("\n");
}
