export const VIEW_FIELDS = "number,url,state,headRefOid,reviewDecision,statusCheckRollup,reviews";

export interface CheckNode {
  __typename?: string;
  name?: string | null;
  workflowName?: string | null;
  context?: string | null;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  startedAt?: string | null;
}

export interface ReviewNode {
  id: string;
  author?: { login?: string } | null;
  state: string;
}

export interface PrView {
  number: number;
  url: string;
  state: string;
  headRefOid: string;
  reviewDecision?: string | null;
  statusCheckRollup?: CheckNode[] | null;
  reviews?: ReviewNode[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

function checkOf(value: unknown): CheckNode | undefined {
  if (!isRecord(value)) return undefined;
  return {
    __typename: textOf(value.__typename) ?? "CheckRun",
    name: textOf(value.name),
    workflowName: textOf(value.workflowName),
    context: textOf(value.context),
    status: textOf(value.status),
    conclusion: textOf(value.conclusion),
    state: textOf(value.state),
    startedAt: textOf(value.startedAt),
  };
}

function reviewOf(value: unknown): ReviewNode | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.state !== "string") {
    return undefined;
  }
  const login = isRecord(value.author) ? textOf(value.author.login) : null;
  return { id: value.id, state: value.state, author: login === null ? null : { login } };
}

function listOf<T>(value: unknown, item: (v: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(item).filter((v): v is T => v !== undefined);
}

/** Narrows `gh pr view --json` output to a PrView, or undefined when it is not one. */
export function parseView(stdout: string): PrView | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    // The caller reports malformed output as an unexpected shape.
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.number !== "number" ||
    typeof value.url !== "string" ||
    typeof value.state !== "string" ||
    typeof value.headRefOid !== "string"
  ) {
    return undefined;
  }
  return {
    number: value.number,
    url: value.url,
    state: value.state,
    headRefOid: value.headRefOid,
    reviewDecision: textOf(value.reviewDecision),
    statusCheckRollup: listOf(value.statusCheckRollup, checkOf),
    reviews: listOf(value.reviews, reviewOf),
  };
}

export type Phase = "none" | "pending" | "passing" | "failing";

export interface Snapshot {
  pr: number;
  url: string;
  state: string;
  head: string;
  phase: Phase;
  total: number;
  pending: number;
  failed: string[];
  reviewDecision: string;
  reviews: { id: string; author: string; state: string }[];
}

export type Decision =
  | { action: "promote"; kind: "ci.failed"; failed: string[] }
  | { action: "promote"; kind: "review.changes_requested"; author: string }
  | { action: "drop"; kind: "ci.passing" | "ci.pending" | "ci.none" }
  | { action: "drop"; kind: "push"; from: string }
  | { action: "drop"; kind: "pr.closed" | "pr.merged" }
  | { action: "drop"; kind: "review"; author: string; state: string };

export type Promoted = Extract<Decision, { action: "promote" }>;

// CANCELLED stays out: a newer push or a concurrency group usually cancelled it.
const FAILED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

type Outcome = "pending" | "passed" | "failed";

function outcomeOf(node: CheckNode): Outcome {
  if (node.__typename === "StatusContext") {
    if (PENDING_STATES.has(node.state ?? "")) return "pending";
    return FAILED.has(node.state ?? "") ? "failed" : "passed";
  }
  if (node.status !== "COMPLETED") return "pending";
  return FAILED.has(node.conclusion ?? "") ? "failed" : "passed";
}

const LABEL_MAX = 80;

// Any app with checks access names its checks, and the label reaches the model.
function flatten(text: string): string {
  const flat = text
    .replaceAll(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return flat === "" ? "check" : flat;
}

// The full label identifies a check. Only what is shown is shortened.
function labelOf(node: CheckNode): string {
  if (node.__typename === "StatusContext") return flatten(node.context ?? "status");
  const name = node.name ?? "check";
  return flatten(node.workflowName ? `${node.workflowName} / ${name}` : name);
}

function shown(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

// A rerun lists beside the run it replaces, so keep the latest start per label.
// One not started yet is queued, hence newest.
function latest(nodes: CheckNode[]): CheckNode[] {
  const byLabel = new Map<string, CheckNode>();
  for (const node of nodes) {
    const label = labelOf(node);
    const held = byLabel.get(label);
    if (held === undefined || (held.startedAt ?? "\uFFFF") <= (node.startedAt ?? "\uFFFF")) {
      byLabel.set(label, node);
    }
  }
  return [...byLabel.values()];
}

export function snapshotOf(view: PrView): Snapshot {
  const checks = latest(view.statusCheckRollup ?? []);
  const failed: string[] = [];
  let pending = 0;
  for (const node of checks) {
    const outcome = outcomeOf(node);
    if (outcome === "failed") failed.push(labelOf(node));
    else if (outcome === "pending") pending += 1;
  }
  failed.sort();
  let phase: Phase = "passing";
  if (checks.length === 0) phase = "none";
  else if (failed.length > 0) phase = "failing";
  else if (pending > 0) phase = "pending";
  return {
    pr: view.number,
    url: view.url,
    state: view.state,
    head: view.headRefOid,
    phase,
    total: checks.length,
    pending,
    failed,
    reviewDecision: view.reviewDecision ?? "",
    reviews: (view.reviews ?? []).map((r) => ({
      id: r.id,
      author: r.author?.login ?? "someone",
      state: r.state,
    })),
  };
}

/**
 * What changed between two polls of the same PR. A check that newly fails, or
 * a review requesting changes, is promoted. Every other change is dropped.
 */
export function decide(prev: Snapshot, next: Snapshot): Decision[] {
  if (next.state !== "OPEN") {
    if (prev.state !== "OPEN") return [];
    return [{ action: "drop", kind: next.state === "MERGED" ? "pr.merged" : "pr.closed" }];
  }
  const decisions: Decision[] = [];
  const isSameHead = prev.head === next.head;
  if (!isSameHead) decisions.push({ action: "drop", kind: "push", from: prev.head });

  const known = new Set(isSameHead ? prev.failed : []);
  const failed = next.failed.filter((label) => !known.has(label));
  if (failed.length > 0) decisions.push({ action: "promote", kind: "ci.failed", failed });
  else if (next.phase !== prev.phase || !isSameHead) {
    if (next.phase === "passing") decisions.push({ action: "drop", kind: "ci.passing" });
    else if (next.phase === "pending") decisions.push({ action: "drop", kind: "ci.pending" });
    else if (next.phase === "none") decisions.push({ action: "drop", kind: "ci.none" });
  }

  const seen = new Set(prev.reviews.map((r) => r.id));
  for (const review of next.reviews) {
    if (seen.has(review.id)) continue;
    decisions.push(
      review.state === "CHANGES_REQUESTED"
        ? { action: "promote", kind: "review.changes_requested", author: review.author }
        : { action: "drop", kind: "review", author: review.author, state: review.state },
    );
  }
  return decisions;
}

const short = (sha: string) => sha.slice(0, 7);

function listed(labels: string[], max = 3): string {
  const head = labels.slice(0, max).map(shown).join(", ");
  return labels.length > max ? `${head} (+${labels.length - max})` : head;
}

function paragraphOf(snapshot: Snapshot, decision: Promoted): string {
  const pr = `PR #${snapshot.pr}`;
  if (decision.kind === "ci.failed") {
    return [
      `CI failed on ${pr} at ${short(snapshot.head)}: ${decision.failed.map(shown).join(", ")}.`,
      `Read the failure with \`gh pr checks ${snapshot.pr}\` and \`gh run view <run> --log-failed\`.`,
    ].join("\n");
  }
  return [
    `@${decision.author} requested changes on ${pr}: ${snapshot.url}`,
    `Read the review with \`gh pr view ${snapshot.pr} --comments\`.`,
  ].join("\n");
}

export function messageOf(snapshot: Snapshot, promoted: Promoted[]): string {
  const paragraphs = promoted.map((decision) => paragraphOf(snapshot, decision));
  paragraphs.push(
    "The github plugin watches this PR's checks and reviews, so polling them is unnecessary.",
  );
  return paragraphs.join("\n\n");
}

// Claude Code's footer already links the PR, so the line shows only what
// needs attention and clears otherwise.
export function statusOf(snapshot: Snapshot, isFlagged: boolean): string | undefined {
  if (snapshot.state !== "OPEN") return undefined;
  const parts: string[] = [];
  if (snapshot.phase === "failing") parts.push(`CI ✗ ${listed(snapshot.failed)}`);
  else if (snapshot.phase === "pending") {
    parts.push(`CI ${snapshot.total - snapshot.pending}/${snapshot.total}`);
  }
  if (snapshot.reviewDecision === "CHANGES_REQUESTED") parts.push("changes requested");
  if (parts.length === 0) return undefined;
  const line = parts.join(" · ");
  return isFlagged ? `${line} → Claude` : line;
}
