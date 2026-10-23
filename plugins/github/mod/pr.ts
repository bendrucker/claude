export const VIEW_FIELDS =
  "number,url,state,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,statusCheckRollup,reviews,comments";

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
  body?: string | null;
  submittedAt?: string | null;
}

export interface CommentNode {
  id: string;
  author?: { login?: string } | null;
  body?: string | null;
  createdAt?: string | null;
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
  /** Requested reviewers yet to review: a user's login, or a team's slug. */
  reviewRequests?: string[] | null;
  /** Each reviewer's latest review. */
  latestReviews?: ReviewNode[] | null;
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
  return {
    id: value.id,
    state: value.state,
    author: loginOf(value.author),
    body: textOf(value.body),
    submittedAt: textOf(value.submittedAt),
  };
}

function commentOf(value: unknown): CommentNode | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return {
    id: value.id,
    author: loginOf(value.author),
    body: textOf(value.body),
    createdAt: textOf(value.createdAt),
    isMinimized: value.isMinimized === true,
    viewerDidAuthor: value.viewerDidAuthor === true,
  };
}

function requestOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return textOf(value.login) ?? textOf(value.slug) ?? textOf(value.name) ?? undefined;
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
    reviewRequests: listOf(value.reviewRequests, requestOf),
    latestReviews: listOf(value.latestReviews, reviewOf),
    statusCheckRollup: listOf(value.statusCheckRollup, checkOf),
    reviews: listOf(value.reviews, reviewOf),
    comments: listOf(value.comments, commentOf),
  };
}

/** What `gh pr view` leaves out, read with one GraphQL query. */
export interface Extras {
  /** Unresolved review threads, each with its latest comment. */
  threads: CommentNode[];
  /** Logins GitHub types as bots among the PR's commenters and reviewers. */
  bots: string[];
  hasQueue: boolean;
  isAutoMerge: boolean;
  /** Position in the merge queue, counted from 1, or undefined when not queued. */
  queued: number | undefined;
}

export const EXTRAS_QUERY = `query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      isMergeQueueEnabled
      autoMergeRequest { enabledAt }
      mergeQueueEntry { position }
      comments(last: 100) { nodes { author { __typename login } } }
      reviews(last: 100) { nodes { author { __typename login } } }
      reviewThreads(first: 100) {
        nodes { isResolved comments(last: 1) { nodes { id author { login } body createdAt } } }
      }
    }
  }
}`;

/** Narrows the EXTRAS_QUERY response, or undefined when it is not one. */
export function parseExtras(stdout: string): Extras | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    // The caller reports malformed output as an unexpected shape.
    return undefined;
  }
  const data = isRecord(value) && isRecord(value.data) ? value.data : undefined;
  const repo = isRecord(data?.repository) ? data.repository : undefined;
  const pr = isRecord(repo?.pullRequest) ? repo.pullRequest : undefined;
  if (pr === undefined) return undefined;
  const nodes = isRecord(pr.reviewThreads) ? pr.reviewThreads.nodes : undefined;
  const threads = listOf(nodes, (thread) => {
    if (!isRecord(thread) || thread.isResolved === true) return undefined;
    const comments = isRecord(thread.comments) ? thread.comments.nodes : undefined;
    return listOf(comments, commentOf).at(-1);
  });
  const entry = isRecord(pr.mergeQueueEntry) ? pr.mergeQueueEntry : undefined;
  const authors = [pr.comments, pr.reviews].flatMap((connection) =>
    listOf(isRecord(connection) ? connection.nodes : undefined, (node) => {
      const author = isRecord(node) && isRecord(node.author) ? node.author : undefined;
      return author?.__typename === "Bot" ? (textOf(author.login) ?? undefined) : undefined;
    }),
  );
  return {
    threads,
    bots: [...new Set(authors)],
    hasQueue: pr.isMergeQueueEnabled === true,
    isAutoMerge: isRecord(pr.autoMergeRequest),
    queued: typeof entry?.position === "number" ? entry.position : undefined,
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
  /** Every check by its latest run, sorted, as the pane lists them. */
  checks: { label: string; outcome: Outcome }[];
  reviewDecision: string;
  /** Requested reviewers other than the session's own login, sorted. */
  requested: string[];
  /** Reviewers whose latest review requests changes and who were not asked again, sorted. */
  asked: string[];
  reviews: { id: string; author: string; state: string }[];
  comments: { id: string; author: string }[];
  /** Comments and checks kept from the model as noise, with why. */
  muted: { id: string; author: string; reason: string }[];
  /** Unresolved review threads whose latest comment is not the session's own. */
  threads: number;
  merging: Merging;
}

/** How the PR merges itself: auto-merge waiting on its checks, or a merge queue. */
export type Merging =
  | { kind: "none"; hasQueue: boolean }
  | { kind: "auto"; hasQueue: boolean }
  | { kind: "queued"; position: number };

/** What counts as noise beyond the built-in chatter rules. */
export interface Noise {
  /** Logins taken as bots beyond the naming conventions. */
  bots: Set<string>;
  /** Logins whose comments are never sent. */
  authors: Set<string>;
  /** A bot comment body that carries nothing to act on. */
  body: RegExp | undefined;
}

const loginsOf = (list: string) =>
  list
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);

/** Reads the plugin's `reviewers`, `ignore`, and `ignoreBody` options. */
export function noiseOf(
  reviewers: string,
  ignore: string,
  ignoreBody: string,
): { noise: Noise; error?: string } {
  const noise: Noise = {
    bots: new Set(loginsOf(reviewers)),
    authors: new Set(loginsOf(ignore)),
    body: undefined,
  };
  if (ignoreBody === "") return { noise };
  try {
    return { noise: { ...noise, body: new RegExp(ignoreBody) } };
  } catch (error) {
    return { noise, error: String(error) };
  }
}

export const NO_NOISE = noiseOf("", "", "").noise;

// `gh pr view` names an author by login alone, which drops an app's `[bot]` suffix,
// so the extras query's author types name the rest.
const BOT = /\[bot\]$|^app\/|[-_]bot$/i;

const isBot = (login: string, noise: Noise) =>
  BOT.test(login) || noise.bots.has(login.toLowerCase());

// What a comment shows once its hidden markup and tags are gone.
const visibleOf = (body: string) =>
  body
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/<[^>]*>/g, "")
    .trim();

// A bot's top-level comment with nothing to act on, by its shape alone: a bot's
// findings arrive as a review, so these are links to a tracker, and summaries and
// acknowledgements led by the hidden marker a bot finds its comment again by.
const CHATTER: [reason: string, test: (body: string, visible: string) => boolean][] = [
  ["link", (body, visible) => !visible.includes("\n") && /https?:\/\//.test(body)],
  ["marked", (body) => body.startsWith("<!--")],
];

function chatterOf(login: string, body: string, noise: Noise): string | undefined {
  if (noise.authors.has(login.toLowerCase())) return "author";
  if (!isBot(login, noise)) return undefined;
  const text = body.trim();
  if (noise.body?.test(text) === true) return "body";
  const visible = visibleOf(text);
  return CHATTER.find(([, test]) => test(text, visible))?.[0];
}

const stem = (text: string) => /[a-z]+/.exec(text.toLowerCase())?.[0] ?? "";

// A review bot also reports its verdict as a check named for it, which its review
// already carries.
function reviewerOf(label: string, bots: string[]): string | undefined {
  const word = stem(label);
  if (word.length < 4) return undefined;
  return bots.find((login) => {
    const name = stem(login);
    return name.length >= 4 && (name.startsWith(word) || word.startsWith(name));
  });
}

/** The session's own login and whether the PR head commit exists locally. */
export interface Local {
  me: string | undefined;
  isHeadKnown: boolean;
  noise?: Noise;
  /** Wall-clock spans of this session's turns, the last one open while a turn runs. */
  turns?: Span[];
  extras?: Extras | undefined;
}

export type Span = [start: number, end: number | undefined];

// The person shares the session's login, so a post under it is the session's own
// when it carries Claude Code's footer or lands while one of its turns runs.
const FOOTER = /Generated (by|with) \[Claude Code\]/;
const SLACK_MS = 10_000;

function isOwn(body: string, at: string | null | undefined, turns: Span[]): boolean {
  if (FOOTER.test(body)) return true;
  const time = Date.parse(at ?? "");
  if (Number.isNaN(time)) return true;
  return turns.some(
    ([start, end]) => time >= start - SLACK_MS && time <= (end ?? Infinity) + SLACK_MS,
  );
}

export type Decision =
  | { action: "promote"; kind: "pr.merged" }
  | { action: "promote"; kind: "pr.closed" }
  | { action: "promote"; kind: "conflict" }
  | { action: "promote"; kind: "behind" }
  | { action: "promote"; kind: "push.foreign"; from: string }
  | { action: "promote"; kind: "ci.failed"; failed: string[] }
  | { action: "promote"; kind: "feedback"; author: string; states: string[]; comments: number }
  | { action: "promote"; kind: "merge.dropped"; from: "auto" | "queued" }
  | { action: "drop"; kind: "merging"; to: Merging["kind"] }
  | { action: "drop"; kind: "unblocked" }
  | { action: "drop"; kind: "ci.passing" | "ci.pending" | "ci.none" }
  | { action: "drop"; kind: "push"; from: string };

export type Promoted = Extract<Decision, { action: "promote" }>;

// CANCELLED stays out: a newer push or a concurrency group usually cancelled it.
const FAILED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

export type Outcome = "pending" | "passed" | "failed";

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

const VERDICTS = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

// A comment after a request for changes leaves it standing, and `latestReviews`
// keeps only the comment, so each reviewer's last verdict decides.
function askedOf(view: PrView): string[] {
  const verdicts = new Map<string, string>();
  for (const r of [...(view.latestReviews ?? []), ...(view.reviews ?? [])]) {
    if (VERDICTS.has(r.state)) verdicts.set(r.author?.login ?? "someone", r.state);
  }
  return [...verdicts]
    .filter(([, state]) => state === "CHANGES_REQUESTED")
    .map(([login]) => login)
    .toSorted();
}

export function snapshotOf(view: PrView, local: Local): Snapshot {
  const { extras, turns = [] } = local;
  const base = local.noise ?? NO_NOISE;
  const noise = {
    ...base,
    bots: new Set([...base.bots, ...(extras?.bots ?? []).map((l) => l.toLowerCase())]),
  };
  const muted: Snapshot["muted"] = [];
  // A reply to a review thread is itself a review, so the session's own replies come back here.
  const reviews: Snapshot["reviews"] = [];
  for (const r of view.reviews ?? []) {
    const author = r.author?.login ?? "someone";
    if (author === local.me && isOwn(r.body ?? "", r.submittedAt, turns)) continue;
    // A bot's bodiless comment review is its reply in a thread, such as an acknowledgement.
    const isReply = r.state === "COMMENTED" && (r.body ?? "").trim() === "" && isBot(author, noise);
    if (isReply) muted.push({ id: r.id, author, reason: "review.reply" });
    else reviews.push({ id: r.id, author, state: r.state });
  }
  const authors = (view.reviews ?? []).map((r) => r.author?.login ?? "someone");
  const bots = [...new Set(authors.filter((login) => login !== local.me && isBot(login, noise)))];
  const checks = latest(view.statusCheckRollup ?? []);
  const failed: string[] = [];
  let pending = 0;
  const listed: Snapshot["checks"] = [];
  for (const node of checks) {
    const outcome = outcomeOf(node);
    const label = labelOf(node);
    listed.push({ label, outcome });
    if (outcome === "pending") pending += 1;
    if (outcome !== "failed") continue;
    // An Actions job is never a review app's verdict.
    const author = node.workflowName ? undefined : reviewerOf(label, bots);
    if (author === undefined) failed.push(label);
    else muted.push({ id: `${view.headRefOid}:${label}`, author, reason: "review.check" });
  }
  failed.sort();
  let phase: Phase = "passing";
  if (checks.length === 0) phase = "none";
  else if (failed.length > 0) phase = "failing";
  else if (pending > 0) phase = "pending";
  const comments: Snapshot["comments"] = [];
  for (const c of view.comments ?? []) {
    const isMine = c.viewerDidAuthor === true || c.author?.login === local.me;
    if (c.isMinimized || (isMine && isOwn(c.body ?? "", c.createdAt, turns))) continue;
    const author = c.author?.login ?? "someone";
    const reason = chatterOf(author, c.body ?? "", noise);
    if (reason === undefined) comments.push({ id: c.id, author });
    else muted.push({ id: c.id, author, reason });
  }
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
    checks: listed.toSorted((a, b) => a.label.localeCompare(b.label)),
    reviewDecision: view.reviewDecision ?? "",
    requested: (view.reviewRequests ?? []).filter((login) => login !== local.me).toSorted(),
    asked: askedOf(view).filter(
      (login) => login !== local.me && !view.reviewRequests?.includes(login),
    ),
    reviews,
    comments,
    muted,
    threads: (extras?.threads ?? []).filter(
      (c) => !(c.author?.login === local.me && isOwn(c.body ?? "", c.createdAt, turns)),
    ).length,
    merging: mergingOf(extras),
  };
}

function mergingOf(extras: Extras | undefined): Merging {
  if (extras?.queued !== undefined) return { kind: "queued", position: extras.queued };
  return {
    kind: extras?.isAutoMerge === true ? "auto" : "none",
    hasQueue: extras?.hasQueue === true,
  };
}

/** Whose move the review waits on, and on whom. */
export interface Turn {
  turn: "author" | "reviewer" | "ready" | "none";
  waiting: string[];
}

// A request for changes holds the turn until its reviewer is asked again, which a
// push alone does not do. A pending request otherwise follows handled feedback.
export function turnOf(snapshot: Snapshot): Turn {
  if (snapshot.asked.length > 0) return { turn: "author", waiting: snapshot.asked };
  if (snapshot.requested.length > 0) return { turn: "reviewer", waiting: snapshot.requested };
  if (snapshot.reviewDecision === "CHANGES_REQUESTED") return { turn: "author", waiting: [] };
  return { turn: snapshot.reviewDecision === "APPROVED" ? "ready" : "none", waiting: [] };
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

  // A reopened PR starts clear, so a block it still carries is news again.
  const before = prev.state === "OPEN" ? prev.block : "none";
  if (isBlocked(next.block) && next.block !== before) {
    decisions.push({ action: "promote", kind: next.block });
  } else if (next.block === "none" && isBlocked(before)) {
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

  const from = prev.merging.kind;
  if (from !== "none" && next.merging.kind === "none") {
    decisions.push({ action: "promote", kind: "merge.dropped", from });
  } else if (from !== next.merging.kind) {
    decisions.push({ action: "drop", kind: "merging", to: next.merging.kind });
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
  const dropped = all.findLast((d) => d.kind === "merge.dropped");
  if (dropped !== undefined) out.push(dropped);
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
  if (decision.kind === "merge.dropped" && decision.from === "queued") {
    return [
      `${pr} left the merge queue without merging: ${snapshot.url}`,
      "The queue tests a merge group, whose checks the PR does not show. Read them with `gh run list --event merge_group`.",
    ].join("\n");
  }
  if (decision.kind === "merge.dropped") {
    return `${pr}'s auto-merge was turned off before it merged: ${snapshot.url}`;
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

/** Whom the PR waits on, which leads the footer. */
export type Ball = "author" | "reviewer" | "merging" | "ci" | "none";

// Anything the author can fix outranks a reviewer, who outranks a merge that
// would wait on them anyway. A required review nobody was asked for, or a green
// PR nothing will merge, is the author's.
export function ballOf(snapshot: Snapshot): Ball {
  if (snapshot.state !== "OPEN") return "none";
  const { turn } = turnOf(snapshot);
  const isFixable = isBlocked(snapshot.block) || snapshot.phase === "failing";
  const isUnasked = turn === "none" && snapshot.reviewDecision === "REVIEW_REQUIRED";
  if (isFixable || isUnasked || turn === "author" || snapshot.threads > 0) return "author";
  if (turn === "reviewer") return "reviewer";
  if (snapshot.merging.kind !== "none") return "merging";
  return snapshot.phase === "pending" ? "ci" : "author";
}

// Nerd Font Octicons, the icons GitHub draws for each state, keyed by glyph
// name: nf-oct-git_merge is gitMerge.
const OCT = {
  alert: "\u{f421}",
  arrowDown: "\u{f433}",
  check: "\u{f42e}",
  checkCircle: "\u{f49e}",
  commentDiscussion: "\u{f442}",
  dotFill: "\u{f444}",
  eye: "\u{f441}",
  gitMerge: "\u{f419}",
  gitMergeQueue: "\u{f4db}",
  gitPullRequestClosed: "\u{f4dc}",
  hourglass: "\u{f4e3}",
  reply: "\u{f4a8}",
  x: "\u{f467}",
  xCircle: "\u{f52f}",
};

/** Between footer segments: a glyph and its count sit one space apart, segments two. */
const SEP = "  ";

// The lead is padded to its longest word, so the glyphs after it hold still as it changes.
const LEAD_WIDTH = "merging".length;

// `isBusy` is a turn running, which is the agent at work on the author's move.
const LEADS: Record<Ball, (isBusy: boolean) => string | undefined> = {
  author: (isBusy) => (isBusy ? "agent" : "you"),
  reviewer: () => "review",
  merging: () => "merging",
  ci: () => "ci",
  none: () => undefined,
};

const BLOCKS: Record<Block, string | undefined> = {
  conflict: `${OCT.gitMerge}${OCT.x}`,
  behind: OCT.arrowDown,
  none: undefined,
};

const ENDED: Partial<Record<string, string>> = {
  MERGED: `${OCT.gitMerge} merged`,
  CLOSED: `${OCT.gitPullRequestClosed} closed`,
};

const CHECKS: Record<Phase, (snapshot: Snapshot) => string | undefined> = {
  none: () => undefined,
  pending: (s) => `${OCT.dotFill} ${s.total - s.pending}/${s.total}`,
  passing: () => OCT.checkCircle,
  failing: (s) => `${OCT.xCircle} ${s.failed.length}`,
};

const TURNS: Record<Turn["turn"], (snapshot: Snapshot, waiting: string[]) => string | undefined> = {
  author: () => OCT.reply,
  reviewer: (_, waiting) => `${OCT.hourglass} ${waiting.length}`,
  ready: () => OCT.check,
  none: (s) => (s.reviewDecision === "REVIEW_REQUIRED" ? OCT.eye : undefined),
};

function mergingPart(merging: Merging): string | undefined {
  if (merging.kind === "queued") return `${OCT.gitMergeQueue} ${merging.position}`;
  return merging.kind === "auto" ? OCT.gitMerge : undefined;
}

// The footer already links the PR, so the state rides after it on that line.
export function statusOf(snapshot: Snapshot, isBusy = false, isStale = false): string {
  const ended = ENDED[snapshot.state];
  if (ended !== undefined) return ended;
  const turn = turnOf(snapshot);
  const details = [
    BLOCKS[snapshot.block ?? "none"],
    CHECKS[snapshot.phase](snapshot),
    TURNS[turn.turn](snapshot, turn.waiting),
    snapshot.threads > 0 ? `${OCT.commentDiscussion} ${snapshot.threads}` : undefined,
    mergingPart(snapshot.merging),
    isStale ? OCT.alert : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(SEP);
  const lead = LEADS[ballOf(snapshot)](isBusy);
  if (lead === undefined) return details;
  return details === "" ? lead : `${lead.padEnd(LEAD_WIDTH)} │ ${details}`;
}
