export const VIEW_FIELDS =
  "number,url,state,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments";

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

export interface CommentNode {
  id: string;
  author?: { login?: string } | null;
  isMinimized?: boolean;
  viewerDidAuthor?: boolean;
}

export interface PrView {
  number: number;
  url: string;
  state: string;
  headRefOid: string;
  baseRefName?: string | null;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  reviewDecision?: string | null;
  statusCheckRollup?: CheckNode[] | null;
  reviews?: ReviewNode[] | null;
  comments?: CommentNode[] | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

const loginOf = (value: unknown): { login: string } | null => {
  const login = isRecord(value) ? textOf(value.login) : null;
  return login === null ? null : { login };
};

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
  return { id: value.id, state: value.state, author: loginOf(value.author) };
}

function commentOf(value: unknown): CommentNode | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    author: loginOf(value.author),
    isMinimized: value.isMinimized === true,
    viewerDidAuthor: value.viewerDidAuthor === true,
  };
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
    baseRefName: textOf(value.baseRefName),
    mergeable: textOf(value.mergeable),
    mergeStateStatus: textOf(value.mergeStateStatus),
    reviewDecision: textOf(value.reviewDecision),
    statusCheckRollup: listOf(value.statusCheckRollup, checkOf),
    reviews: listOf(value.reviews, reviewOf),
    comments: listOf(value.comments, commentOf),
  };
}

export type Phase = "none" | "pending" | "passing" | "failing";

/** What stands between the branch and a merge that the session can fix. */
export type Block = "conflict" | "behind" | "none";

export interface Snapshot {
  pr: number;
  url: string;
  state: string;
  head: string;
  /** False when the head is a commit this checkout has never seen. */
  isHeadKnown: boolean;
  base: string;
  /** Undefined while GitHub is still computing mergeability. */
  block: Block | undefined;
  phase: Phase;
  total: number;
  pending: number;
  failed: string[];
  reviewDecision: string;
  reviews: { id: string; author: string; state: string }[];
  comments: { id: string; author: string }[];
}

/** The session's own login and whether the PR head commit exists locally. */
export interface Local {
  me: string;
  isHeadKnown: boolean;
}

export type Decision =
  | { action: "promote"; kind: "pr.merged" }
  | { action: "promote"; kind: "pr.closed" }
  | { action: "promote"; kind: "conflict" }
  | { action: "promote"; kind: "behind" }
  | { action: "promote"; kind: "push.foreign"; from: string }
  | { action: "promote"; kind: "ci.failed"; failed: string[] }
  | { action: "promote"; kind: "feedback"; author: string; states: string[]; comments: number }
  | { action: "drop"; kind: "unblocked" }
  | { action: "drop"; kind: "ci.passing" | "ci.pending" | "ci.none" }
  | { action: "drop"; kind: "push"; from: string };

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
  const workflow = node.workflowName ?? "";
  return flatten(workflow === "" ? name : `${workflow} / ${name}`);
}

function shown(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

// A rerun lists beside the run it replaces, so keep the latest start per label.
// One not started yet is queued, hence newest.
function latest(nodes: CheckNode[]): CheckNode[] {
  const byLabel = new Map<string, CheckNode>();
  for (const node of nodes) {
    const label = `${node.__typename}:${labelOf(node)}`;
    const held = byLabel.get(label);
    if (held === undefined || (held.startedAt ?? "\uFFFF") <= (node.startedAt ?? "\uFFFF")) {
      byLabel.set(label, node);
    }
  }
  return [...byLabel.values()];
}

// `mergeable` and `mergeStateStatus` can lag each other, so either one decides.
// GitHub reports BEHIND only where a ruleset requires an up-to-date branch.
function blockOf(view: PrView): Block | undefined {
  if (view.mergeable === "CONFLICTING" || view.mergeStateStatus === "DIRTY") return "conflict";
  if (view.mergeStateStatus === "BEHIND") return "behind";
  if (view.mergeable === "UNKNOWN" || view.mergeStateStatus === "UNKNOWN") return undefined;
  return "none";
}

export function snapshotOf(view: PrView, local: Local): Snapshot {
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
  // A reply to a review thread is itself a review, so the session's own replies come back here.
  const reviews = (view.reviews ?? [])
    .map((r) => ({ id: r.id, author: r.author?.login ?? "someone", state: r.state }))
    .filter((r) => r.author !== local.me);
  const comments = (view.comments ?? [])
    .filter((c) => !c.isMinimized && !c.viewerDidAuthor && c.author?.login !== local.me)
    .map((c) => ({ id: c.id, author: c.author?.login ?? "someone" }));
  return {
    pr: view.number,
    url: view.url,
    state: view.state,
    head: view.headRefOid,
    isHeadKnown: local.isHeadKnown,
    base: view.baseRefName ?? "",
    block: blockOf(view),
    phase,
    total: checks.length,
    pending,
    failed,
    reviewDecision: view.reviewDecision ?? "",
    reviews,
    comments,
  };
}

const isBlocked = (block: Block | undefined): block is "conflict" | "behind" =>
  block === "conflict" || block === "behind";

/** What a PR first seen already blocked has to say. Nothing else counts at baseline. */
export function baselineOf(snapshot: Snapshot): Promoted[] {
  if (snapshot.state !== "OPEN" || !isBlocked(snapshot.block)) return [];
  return [{ action: "promote", kind: snapshot.block }];
}

function feedbackOf(prev: Snapshot, next: Snapshot): Decision[] {
  const seen = new Set([...prev.reviews.map((r) => r.id), ...prev.comments.map((c) => c.id)]);
  const byAuthor = new Map<string, { states: string[]; comments: number }>();
  const entry = (author: string) => {
    const held = byAuthor.get(author) ?? { states: [], comments: 0 };
    byAuthor.set(author, held);
    return held;
  };
  for (const review of next.reviews) {
    if (!seen.has(review.id)) entry(review.author).states.push(review.state);
  }
  for (const comment of next.comments) {
    if (!seen.has(comment.id)) entry(comment.author).comments += 1;
  }
  return [...byAuthor].map(([author, { states, comments }]) => ({
    action: "promote",
    kind: "feedback",
    author,
    states,
    comments,
  }));
}

/**
 * What changed between two polls of the same PR. The PR merging or closing, a
 * new conflict or required update, a push from outside this checkout, a check
 * that newly fails, and new reviews or comments from someone else are promoted.
 * Every other change is dropped.
 */
export function decide(prev: Snapshot, next: Snapshot): Decision[] {
  if (next.state !== "OPEN") {
    if (prev.state !== "OPEN") return [];
    return [{ action: "promote", kind: next.state === "MERGED" ? "pr.merged" : "pr.closed" }];
  }
  const decisions: Decision[] = [];
  const isSameHead = prev.head === next.head;
  if (!isSameHead) {
    decisions.push(
      next.isHeadKnown
        ? { action: "drop", kind: "push", from: prev.head }
        : { action: "promote", kind: "push.foreign", from: prev.head },
    );
  }

  if (isBlocked(next.block) && next.block !== prev.block) {
    decisions.push({ action: "promote", kind: next.block });
  } else if (next.block === "none" && isBlocked(prev.block)) {
    decisions.push({ action: "drop", kind: "unblocked" });
  }

  const known = new Set(isSameHead ? prev.failed : []);
  const failed = next.failed.filter((label) => !known.has(label));
  if (failed.length > 0) decisions.push({ action: "promote", kind: "ci.failed", failed });
  else if (next.phase !== prev.phase || !isSameHead) {
    if (next.phase === "passing") decisions.push({ action: "drop", kind: "ci.passing" });
    else if (next.phase === "pending") decisions.push({ action: "drop", kind: "ci.pending" });
    else if (next.phase === "none") decisions.push({ action: "drop", kind: "ci.none" });
  }

  decisions.push(...feedbackOf(prev, next));
  return decisions;
}

/**
 * Folds a retried send into fresh decisions as one message: the latest block,
 * the earliest foreign push, every failed check once, and one entry per author.
 */
export function combine(carried: Promoted[], fresh: Promoted[]): Promoted[] {
  const all = [...carried, ...fresh];
  const ended = all.findLast((d) => d.kind === "pr.merged" || d.kind === "pr.closed");
  if (ended !== undefined) return [ended];
  const out: Promoted[] = [];
  const block = all.findLast((d) => d.kind === "conflict" || d.kind === "behind");
  if (block !== undefined) out.push(block);
  const push = all.find((d) => d.kind === "push.foreign");
  if (push !== undefined) out.push(push);
  const failed = all.flatMap((d) => (d.kind === "ci.failed" ? d.failed : []));
  if (failed.length > 0) {
    out.push({ action: "promote", kind: "ci.failed", failed: [...new Set(failed)].toSorted() });
  }
  const byAuthor = new Map<string, { states: string[]; comments: number }>();
  for (const d of all) {
    if (d.kind !== "feedback") continue;
    const held = byAuthor.get(d.author) ?? { states: [], comments: 0 };
    byAuthor.set(d.author, {
      states: [...held.states, ...d.states],
      comments: held.comments + d.comments,
    });
  }
  for (const [author, { states, comments }] of byAuthor) {
    out.push({ action: "promote", kind: "feedback", author, states, comments });
  }
  return out;
}

const short = (sha: string) => sha.slice(0, 7);

function listed(labels: string[], max = 3): string {
  const head = labels.slice(0, max).map(shown).join(", ");
  return labels.length > max ? `${head} (+${labels.length - max})` : head;
}

function counted(states: string[]): string[] {
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  return [...counts].map(([state, n]) => (n === 1 ? state : `${state} ×${n}`));
}

function feedbackLineOf(pr: string, decision: Extract<Promoted, { kind: "feedback" }>): string {
  const { author, states, comments } = decision;
  const details = counted(states);
  if (comments > 0) details.push(comments === 1 ? "1 new comment" : `${comments} new comments`);
  const verb = states.length > 0 ? "reviewed" : "commented on";
  return `@${author} ${verb} ${pr} (${details.join(", ")})`;
}

function paragraphOf(
  snapshot: Snapshot,
  decision: Exclude<Promoted, { kind: "feedback" }>,
): string {
  const pr = `PR #${snapshot.pr}`;
  const base = snapshot.base === "" ? "its base branch" : `\`${snapshot.base}\``;
  if (decision.kind === "pr.merged") return `${pr} merged: ${snapshot.url}`;
  if (decision.kind === "pr.closed") return `${pr} closed without merging: ${snapshot.url}`;
  if (decision.kind === "conflict") {
    return [
      `${pr} has merge conflicts with ${base} at ${short(snapshot.head)}.`,
      `Update the branch from ${base}, resolve the conflicts with the \`git:conflicts\` skill, and push.`,
    ].join("\n");
  }
  if (decision.kind === "behind") {
    return [
      `${pr} is behind ${base} at ${short(snapshot.head)}, and merging requires an up-to-date branch.`,
      `Update the branch from ${base}, resolve any conflicts with the \`git:conflicts\` skill, and push.`,
    ].join("\n");
  }
  if (decision.kind === "push.foreign") {
    return [
      `${pr}'s branch moved from ${short(decision.from)} to ${short(snapshot.head)}, a commit this checkout does not have.`,
      "Pull it before committing or pushing again.",
    ].join("\n");
  }
  return [
    `CI failed on ${pr} at ${short(snapshot.head)}: ${decision.failed.map(shown).join(", ")}.`,
    `Read the failure with \`gh pr checks ${snapshot.pr}\` and \`gh run view <run> --log-failed\`.`,
  ].join("\n");
}

export function messageOf(snapshot: Snapshot, promoted: Promoted[]): string {
  const paragraphs: string[] = [];
  const feedback: string[] = [];
  for (const decision of promoted) {
    if (decision.kind === "feedback") feedback.push(feedbackLineOf(`PR #${snapshot.pr}`, decision));
    else paragraphs.push(paragraphOf(snapshot, decision));
  }
  if (feedback.length > 0) {
    paragraphs.push(
      [...feedback, snapshot.url, `Read it with \`gh pr view ${snapshot.pr} --comments\`.`].join(
        "\n",
      ),
    );
  }
  if (snapshot.state === "OPEN") {
    paragraphs.push(
      "The github plugin watches this PR's checks, reviews, comments, and mergeability, so polling them is unnecessary.",
    );
  }
  return paragraphs.join("\n\n");
}

// Nerd Font Octicons, the icons GitHub itself draws for each state.
export const STALE = "\u{f421} stale";

const BLOCKS: Record<Block, string | undefined> = {
  conflict: "\u{f47f} conflicts",
  behind: "\u{f47f} behind",
  none: undefined,
};

const ENDED: Partial<Record<string, string>> = {
  MERGED: "\u{f419} merged",
  CLOSED: "\u{f4dc} closed",
};

const CHECKS: Record<Phase, (snapshot: Snapshot) => string | undefined> = {
  none: () => undefined,
  pending: (s) => `\u{f444} CI ${s.total - s.pending}/${s.total}`,
  passing: () => "\u{f49e} CI",
  failing: (s) => `\u{f52f} ${listed(s.failed)}`,
};

const REVIEWS: Partial<Record<string, string>> = {
  APPROVED: "\u{f42e} approved",
  CHANGES_REQUESTED: "\u{f4d2} changes requested",
  REVIEW_REQUIRED: "\u{f441} review needed",
};

// The footer already links the PR, so the state rides after it on that line.
export function statusOf(snapshot: Snapshot): string {
  const ended = ENDED[snapshot.state];
  if (ended !== undefined) return ended;
  return [
    BLOCKS[snapshot.block ?? "none"],
    CHECKS[snapshot.phase](snapshot),
    REVIEWS[snapshot.reviewDecision],
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}
