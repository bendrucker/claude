type Reader<T> = (value: unknown) => T | undefined;
type Out<R> = R extends Reader<infer T> ? T : never;
type Shaped<S> = { [K in keyof S]: Out<S[K]> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str: Reader<string> = (value) => (typeof value === "string" ? value : undefined);
const num: Reader<number> = (value) => (typeof value === "number" ? value : undefined);
const bool: Reader<boolean> = (value) => (typeof value === "boolean" ? value : undefined);

const or =
  <T, F>(read: Reader<T>, fallback: F): Reader<T | F> =>
  (value) =>
    read(value) ?? fallback;

const map =
  <T, U>(read: Reader<T>, to: (value: T) => U): Reader<U> =>
  (value) => {
    const result = read(value);
    return result === undefined ? undefined : to(result);
  };

const list =
  <T>(item: Reader<T>): Reader<T[]> =>
  (value) =>
    Array.isArray(value)
      ? value.map(item).filter((entry): entry is T => entry !== undefined)
      : undefined;

function obj<S extends Record<string, Reader<unknown>>>(shape: S): Reader<Shaped<S>> {
  // Every field holds its own reader's output, so a full read fits the shape.
  const isRead = (out: Record<string, unknown>): out is Shaped<S> =>
    Object.keys(shape).every((key) => out[key] !== undefined);
  return (value) => {
    if (!isRecord(value)) return undefined;
    const out = Object.fromEntries(
      Object.entries(shape).map(([key, read]) => [key, read(value[key])]),
    );
    return isRead(out) ? out : undefined;
  };
}

function decoded<T>(stdout: string, read: Reader<T>): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    // The caller reports malformed output as an unexpected shape.
    return undefined;
  }
  return read(value);
}

const readUsername = map(obj({ username: str }), (user) => user.username);

const readPipeline = map(obj({ id: num, project_id: num, status: str }), (p) => ({
  id: p.id,
  projectId: p.project_id,
  status: p.status,
}));

const readView = map(
  obj({
    iid: num,
    project_id: num,
    web_url: str,
    state: str,
    sha: str,
    updated_at: or(str, ""),
    target_branch: or(str, ""),
    has_conflicts: or(bool, false),
    detailed_merge_status: or(str, null),
    head_pipeline: or(readPipeline, null),
  }),
  (v) => ({
    iid: v.iid,
    projectId: v.project_id,
    url: v.web_url,
    state: v.state,
    sha: v.sha,
    updatedAt: v.updated_at,
    target: v.target_branch,
    hasConflicts: v.has_conflicts,
    detailedMergeStatus: v.detailed_merge_status,
    pipeline: v.head_pipeline,
  }),
);

const readApprovals = map(
  obj({
    approvals_required: or(num, 0),
    approvals_left: or(num, 0),
    approved_by: list(map(obj({ user: readUsername }), (entry) => entry.user)),
  }),
  (a) => ({
    approvalsRequired: a.approvals_required,
    approvalsLeft: a.approvals_left,
    approvedBy: a.approved_by,
  }),
);

const readNote = map(
  obj({
    id: num,
    author: or(readUsername, "someone"),
    body: or(str, ""),
    system: or(bool, false),
    type: or(str, ""),
    created_at: or(str, ""),
  }),
  (n) => ({
    id: n.id,
    author: n.author,
    body: n.body,
    isSystem: n.system,
    type: n.type,
    createdAt: n.created_at,
  }),
);

const readJob = map(
  obj({ id: num, name: or(str, "job"), status: str, allow_failure: or(bool, false) }),
  (j) => ({ id: j.id, name: j.name, status: j.status, allowFailure: j.allow_failure }),
);

const readReviewer = map(
  obj({
    username: str,
    mergeRequestInteraction: or(obj({ reviewState: or(str, "") }), { reviewState: "" }),
  }),
  (r) => ({ user: r.username, state: r.mergeRequestInteraction.reviewState }),
);

// REST reports every reviewer as active, so review state comes from GraphQL.
const readReviewers = map(
  obj({
    data: obj({
      project: obj({ mergeRequest: obj({ reviewers: obj({ nodes: list(readReviewer) }) }) }),
    }),
  }),
  (r) => r.data.project.mergeRequest.reviewers.nodes,
);

const readDiscussion = map(
  obj({
    notes: list(
      obj({
        author: or(readUsername, "someone"),
        body: or(str, ""),
        created_at: or(str, ""),
        resolvable: or(bool, false),
        resolved: or(bool, false),
      }),
    ),
  }),
  (d) => ({
    isOpen: d.notes.some((n) => n.resolvable && !n.resolved),
    last: d.notes.at(-1),
  }),
);

const readMerge = map(
  obj({
    data: obj({
      project: obj({
        ciCdSettings: or(obj({ mergeTrainsEnabled: or(bool, false) }), {
          mergeTrainsEnabled: false,
        }),
        mergeRequest: obj({
          autoMergeEnabled: or(bool, false),
          mergeTrainIndex: or(num, null),
        }),
      }),
    }),
  }),
  ({ data: { project } }): Merging => {
    const index = project.mergeRequest.mergeTrainIndex;
    if (index !== null) return { kind: "queued", position: index + 1 };
    const hasQueue = project.ciCdSettings.mergeTrainsEnabled;
    return { kind: project.mergeRequest.autoMergeEnabled ? "auto" : "none", hasQueue };
  },
);

export type MrView = Out<typeof readView>;
export type Approvals = Out<typeof readApprovals>;
export type Note = Out<typeof readNote>;
export type Job = Out<typeof readJob>;
export type Reviewer = Out<typeof readReviewer>;
export type Discussion = Out<typeof readDiscussion>;

/** Narrows `glab mr view -F json` output to an MrView, or undefined when it is not one. */
export const parseView = (stdout: string): MrView | undefined => decoded(stdout, readView);
export const parseApprovals = (stdout: string): Approvals | undefined =>
  decoded(stdout, readApprovals);
export const parseNotes = (stdout: string): Note[] | undefined => decoded(stdout, list(readNote));
// `glab api --paginate --output ndjson` prints one item per line across every page.
const ndjson = (stdout: string) => `[${stdout.split("\n").filter(Boolean).join(",")}]`;
export const parseJobs = (stdout: string): Job[] | undefined =>
  decoded(ndjson(stdout), list(readJob));
export const parseUser = (stdout: string): string | undefined => decoded(stdout, readUsername);
export const parseReviewers = (stdout: string): Reviewer[] | undefined =>
  decoded(stdout, readReviewers);
export const parseDiscussions = (stdout: string): Discussion[] | undefined =>
  decoded(ndjson(stdout), list(readDiscussion));
export const parseMerge = (stdout: string): Merging | undefined => decoded(stdout, readMerge);

export type Phase = "none" | "pending" | "passing" | "failing";

/** What stands between the branch and a merge that the session can fix. */
export type Block = "conflict" | "behind" | "none";

export interface Snapshot {
  mr: number;
  projectId: number;
  url: string;
  state: string;
  head: string;
  /** False when the head is a commit this checkout has never seen. */
  isHeadKnown: boolean;
  target: string;
  /** Undefined while GitLab is still computing mergeability. */
  block: Block | undefined;
  pipeline: number | undefined;
  phase: Phase;
  total: number;
  pending: number;
  failed: string[];
  /** Every job, sorted, as the pane lists them. */
  checks: { label: string; outcome: "pending" | "passed" | "failed" }[];
  isChangesRequested: boolean;
  isApproved: boolean;
  approvalsLeft: number;
  approvers: string[];
  /** Reviewers other than the session's own user yet to review, sorted. */
  requested: string[];
  /** Reviewers other than the session's own user who requested changes, sorted. */
  asked: string[];
  noteCursor: number;
  notes: { id: number; author: string }[];
  /** Notes kept from the model as noise, with why. */
  muted: { id: string; author: string; reason: string }[];
  /** Unresolved threads whose latest note is not the session's own. */
  threads: number;
  merging: Merging;
}

/** How the MR merges itself: auto-merge waiting on its pipeline, or a merge train. */
export type Merging =
  | { kind: "none"; hasQueue: boolean }
  | { kind: "auto"; hasQueue: boolean }
  | { kind: "queued"; position: number };

/** What counts as noise beyond the built-in chatter rules. */
export interface Noise {
  /** Usernames taken as bots beyond the service-account conventions. */
  bots: Set<string>;
  /** Usernames whose notes are never sent. */
  authors: Set<string>;
  /** A bot note body that carries nothing to act on. */
  body: RegExp | undefined;
}

const usernamesOf = (names: string) =>
  names
    .split(",")
    .map((username) => username.trim().toLowerCase())
    .filter(Boolean);

/** Reads the plugin's `reviewers`, `ignore`, and `ignoreBody` options. */
export function noiseOf(
  reviewers: string,
  ignore: string,
  ignoreBody: string,
): { noise: Noise; error?: string } {
  const noise: Noise = {
    bots: new Set(["coderabbitai", "linear", ...usernamesOf(reviewers)]),
    authors: new Set(usernamesOf(ignore)),
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

// Service accounts end in `-bot` or `_bot`, and token accounts are `group_<id>_bot_<hash>`.
const SERVICE_ACCOUNT = /[_-]bot$|^(?:group|project)_\d+_bot_[0-9a-f]+$/;

const isBot = (username: string, noise: Noise) => {
  const name = username.toLowerCase();
  return SERVICE_ACCOUNT.test(name) || noise.bots.has(name);
};

const ACK =
  /^(?=[\s\S]*<!-- This is an auto-generated reply by CodeRabbit -->)[\s\S]*Actions performed/;

// Bot notes with nothing to act on, by what the bot writes.
const CHATTER: [reason: string, body: RegExp][] = [
  // CodeRabbit's walkthrough, edited in place. Its findings arrive as diff notes.
  ["coderabbit.summary", /<!-- This is an auto-generated comment: [^>]* by coderabbit\.ai -->/],
  ["coderabbit.ack", ACK],
  [
    "linkback",
    /^[^\n]{0,300}(linear\.app\/[^/\s]+\/issue\/|\.atlassian\.net\/browse\/)[^\n]{0,300}$/,
  ],
];

function chatterOf(note: Note, noise: Noise): string | undefined {
  if (noise.authors.has(note.author.toLowerCase())) return "author";
  if (!isBot(note.author, noise)) return undefined;
  const text = note.body.trim();
  // A bot's note on a diff line is a finding, unless it is CodeRabbit's marked ack.
  if (note.type === "DiffNote") return ACK.test(text) ? "coderabbit.ack" : undefined;
  if (noise.body?.test(text) === true) return "body";
  return CHATTER.find(([, pattern]) => pattern.test(text))?.[0];
}

export type Approval = "approved" | "unapproved" | null;

export type Decision =
  | { action: "promote"; kind: "mr.merged" }
  | { action: "promote"; kind: "mr.closed" }
  | { action: "promote"; kind: "conflict" }
  | { action: "promote"; kind: "behind" }
  | { action: "promote"; kind: "push.foreign"; from: string }
  | { action: "promote"; kind: "ci.failed"; failed: string[] }
  | { action: "promote"; kind: "changes_requested" }
  | { action: "promote"; kind: "feedback"; author: string; approval: Approval; notes: number }
  | { action: "promote"; kind: "merge.dropped"; from: "auto" | "queued" }
  | { action: "drop"; kind: "merging"; to: Merging["kind"] }
  | { action: "drop"; kind: "unblocked" }
  | { action: "drop"; kind: "ci.passing" | "ci.pending" | "ci.none" }
  | { action: "drop"; kind: "push"; from: string }
  | { action: "drop"; kind: "approvals.reset"; authors: string[] };

export type Promoted = Extract<Decision, { action: "promote" }>;

// A locked MR is mid-merge and still open.
const OPEN = new Set(["opened", "locked"]);
export const isOpen = (snapshot: Snapshot): boolean => OPEN.has(snapshot.state);

const PENDING = new Set([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "scheduled",
]);

// A pipeline is manual only when a blocking manual job holds it, while a
// non-blocking manual job sits in a finished pipeline.
const PIPELINE_PENDING = new Set([...PENDING, "manual"]);

const LABEL_MAX = 80;

// Anyone who can edit .gitlab-ci.yml names its jobs, and the label reaches the model.
function flatten(text: string): string {
  const flat = text
    .replaceAll(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return flat === "" ? "job" : flat;
}

function shown(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

export interface Read {
  view: MrView;
  approvals: Approvals;
  notes: Note[];
  jobs: Job[];
  reviewers: Reviewer[];
  discussions?: Discussion[];
  merging?: Merging;
  me: string;
  isHeadKnown: boolean;
  noise?: Noise;
  /** Wall-clock spans of this session's turns, the last one open while a turn runs. */
  turns?: Span[];
}

export type Span = [start: number, end: number | undefined];

// The person shares the session's username, so a note under it is the session's own
// when it carries Claude Code's footer or lands while one of its turns runs.
const FOOTER = /Generated (by|with) \[Claude Code\]/;
const SLACK_MS = 10_000;

function isOwn(body: string, at: string, turns: Span[]): boolean {
  if (FOOTER.test(body)) return true;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return true;
  return turns.some(
    ([start, end]) => time >= start - SLACK_MS && time <= (end ?? Infinity) + SLACK_MS,
  );
}

function phaseOf(read: Read, failed: string[], pending: number): Phase {
  const pipeline = read.view.pipeline;
  if (pipeline === null) return "none";
  if (failed.length > 0) return "failing";
  if (pending > 0 || PIPELINE_PENDING.has(pipeline.status)) return "pending";
  if (pipeline.status === "canceled" || pipeline.status === "skipped") return "none";
  return "passing";
}

const UNDECIDED = new Set(["checking", "unchecked", "preparing"]);

// `detailed_merge_status` can lead `has_conflicts`, so either one decides.
// GitLab reports need_rebase only where the merge method requires an up-to-date branch.
function blockOf(view: MrView): Block | undefined {
  if (view.hasConflicts || view.detailedMergeStatus === "conflict") return "conflict";
  if (UNDECIDED.has(view.detailedMergeStatus ?? "")) return undefined;
  return view.detailedMergeStatus === "need_rebase" ? "behind" : "none";
}

const WAITING = new Set(["UNREVIEWED", "REVIEW_STARTED"]);

const reviewersIn = ({ reviewers, me }: Read, states: Set<string>) =>
  reviewers
    .filter((r) => states.has(r.state) && r.user !== me)
    .map((r) => r.user)
    .toSorted();

export function snapshotOf(read: Read): Snapshot {
  const { view, approvals, notes, jobs, me, turns = [] } = read;
  const failed: string[] = [];
  let pending = 0;
  const isManual = view.pipeline?.status === "manual";
  const checks: Snapshot["checks"] = [];
  for (const job of jobs) {
    const label = flatten(job.name);
    if (job.status === "failed" && !job.allowFailure) {
      failed.push(label);
      checks.push({ label, outcome: "failed" });
    } else if (PENDING.has(job.status) || (isManual && job.status === "manual")) {
      pending += 1;
      checks.push({ label, outcome: "pending" });
    } else {
      checks.push({ label, outcome: "passed" });
    }
  }
  // A failed downstream pipeline fails its trigger job, which the jobs list leaves out.
  if (view.pipeline?.status === "failed" && failed.length === 0) failed.push("pipeline");
  failed.sort();
  const noise = read.noise ?? NO_NOISE;
  const kept: Snapshot["notes"] = [];
  const muted: Snapshot["muted"] = [];
  for (const note of notes) {
    const { id, author } = note;
    if (note.isSystem || (author === me && isOwn(note.body, note.createdAt, turns))) {
      continue;
    }
    const reason = chatterOf(note, noise);
    if (reason === undefined) kept.push({ id, author });
    else muted.push({ id: String(id), author, reason });
  }
  return {
    mr: view.iid,
    projectId: view.projectId,
    url: view.url,
    state: view.state,
    head: view.sha,
    isHeadKnown: read.isHeadKnown,
    target: view.target,
    block: blockOf(view),
    pipeline: view.pipeline?.id,
    phase: phaseOf(read, failed, pending),
    total: jobs.length,
    pending,
    failed: [...new Set(failed)],
    checks: checks.toSorted((a, b) => a.label.localeCompare(b.label)),
    isChangesRequested: view.detailedMergeStatus === "requested_changes",
    isApproved: approvals.approvedBy.length > 0 && approvals.approvalsLeft === 0,
    approvalsLeft: approvals.approvalsLeft,
    approvers: approvals.approvedBy.filter((name) => name !== me).toSorted(),
    // A re-request resets a reviewer to unreviewed.
    requested: reviewersIn(read, WAITING),
    asked: reviewersIn(read, new Set(["REQUESTED_CHANGES"])),
    noteCursor: Math.max(0, ...notes.map((n) => n.id)),
    notes: kept,
    muted,
    threads: (read.discussions ?? []).filter(
      (d) => d.isOpen && !(d.last?.author === me && isOwn(d.last.body, d.last.created_at, turns)),
    ).length,
    merging: read.merging ?? { kind: "none", hasQueue: false },
  };
}

/** Whose move the review waits on, and on whom. */
export interface Turn {
  turn: "author" | "reviewer" | "ready" | "none";
  waiting: string[];
}

// A request for changes holds the turn until its reviewer is asked again, which
// resets them to unreviewed. A pending request otherwise follows handled feedback.
export function turnOf(snapshot: Snapshot): Turn {
  if (snapshot.asked.length > 0) return { turn: "author", waiting: snapshot.asked };
  if (snapshot.requested.length > 0) return { turn: "reviewer", waiting: snapshot.requested };
  if (snapshot.isChangesRequested) return { turn: "author", waiting: [] };
  return { turn: snapshot.isApproved ? "ready" : "none", waiting: [] };
}

const isBlocked = (block: Block | undefined): block is "conflict" | "behind" =>
  block === "conflict" || block === "behind";

/** What an MR first seen already blocked has to say. Nothing else counts at baseline. */
export function baselineOf(snapshot: Snapshot): Promoted[] {
  if (!isOpen(snapshot) || !isBlocked(snapshot.block)) return [];
  return [{ action: "promote", kind: snapshot.block }];
}

type Feedback = Extract<Promoted, { kind: "feedback" }>;

function feedbackOf(prev: Snapshot, next: Snapshot, isSameHead: boolean): Decision[] {
  const decisions: Decision[] = [];
  const byAuthor = new Map<string, Feedback>();
  const entry = (author: string): Feedback => {
    const held = byAuthor.get(author) ?? {
      action: "promote",
      kind: "feedback",
      author,
      approval: null,
      notes: 0,
    };
    byAuthor.set(author, held);
    return held;
  };
  const before = new Set(prev.approvers);
  const after = new Set(next.approvers);
  for (const author of next.approvers) {
    if (!before.has(author)) entry(author).approval = "approved";
  }
  const removed = prev.approvers.filter((author) => !after.has(author));
  // A push can reset approvals, which no reviewer did.
  if (removed.length > 0 && !isSameHead) {
    decisions.push({ action: "drop", kind: "approvals.reset", authors: removed });
  } else {
    for (const author of removed) entry(author).approval = "unapproved";
  }
  for (const note of next.notes.toSorted((a, b) => a.id - b.id)) {
    if (note.id > prev.noteCursor) entry(note.author).notes += 1;
  }

  // GitLab names no reviewer for a request for changes.
  if (next.isChangesRequested && !prev.isChangesRequested) {
    decisions.push({ action: "promote", kind: "changes_requested" });
  }
  decisions.push(...byAuthor.values());
  return decisions;
}

/**
 * What changed between two polls of the same MR. The MR merging or closing, a
 * new conflict or required rebase, a push from outside this checkout, a job
 * that newly fails, a request for changes, and new approvals, unapprovals, or
 * comments from someone else are promoted. Every other change is dropped.
 */
export function decide(prev: Snapshot, next: Snapshot): Decision[] {
  if (!isOpen(next)) {
    if (!isOpen(prev)) return [];
    return [{ action: "promote", kind: next.state === "merged" ? "mr.merged" : "mr.closed" }];
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

  // A reopened MR starts clear, so a block it still carries is news again.
  const before = isOpen(prev) ? prev.block : "none";
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

  decisions.push(...feedbackOf(prev, next, isSameHead));
  return decisions;
}

// An approval and its revocation cancel out, since the model saw neither.
function approvalOf(carried: Approval, fresh: Approval): Approval {
  if (fresh === null) return carried;
  if (carried === null) return fresh;
  return carried === fresh ? fresh : null;
}

/**
 * Folds a retried send into fresh decisions as one message: the latest block,
 * the earliest foreign push, every failed job once, and one entry per author
 * holding their latest approval change.
 */
export function combine(carried: Promoted[], fresh: Promoted[]): Promoted[] {
  const all = [...carried, ...fresh];
  const ended = all.findLast((d) => d.kind === "mr.merged" || d.kind === "mr.closed");
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
  if (all.some((d) => d.kind === "changes_requested")) {
    out.push({ action: "promote", kind: "changes_requested" });
  }
  const byAuthor = new Map<string, Feedback>();
  for (const d of all) {
    if (d.kind !== "feedback") continue;
    const held = byAuthor.get(d.author);
    byAuthor.set(d.author, {
      ...d,
      approval: approvalOf(held?.approval ?? null, d.approval),
      notes: (held?.notes ?? 0) + d.notes,
    });
  }
  out.push(...byAuthor.values());
  return out;
}

const short = (sha: string) => sha.slice(0, 7);

function feedbackLineOf(mr: string, decision: Feedback): string {
  const { author, approval, notes } = decision;
  const comments = notes === 1 ? "1 new comment" : `${notes} new comments`;
  if (approval === null) return `@${author} commented on ${mr} (${comments})`;
  const line =
    approval === "approved"
      ? `@${author} approved ${mr}`
      : `@${author} revoked their approval of ${mr}`;
  return notes > 0 ? `${line} (${comments})` : line;
}

function paragraphOf(
  snapshot: Snapshot,
  decision: Exclude<Promoted, { kind: "feedback" | "changes_requested" }>,
): string {
  const mr = `MR !${snapshot.mr}`;
  const target = snapshot.target === "" ? "its target branch" : `\`${snapshot.target}\``;
  if (decision.kind === "mr.merged") return `${mr} merged: ${snapshot.url}`;
  if (decision.kind === "mr.closed") return `${mr} closed without merging: ${snapshot.url}`;
  if (decision.kind === "merge.dropped" && decision.from === "queued") {
    return [
      `${mr} left the merge train without merging: ${snapshot.url}`,
      `Read why in its system notes with \`glab mr view ${snapshot.mr} --comments --system-logs\`.`,
    ].join("\n");
  }
  if (decision.kind === "merge.dropped") {
    return `${mr}'s auto-merge was turned off before it merged: ${snapshot.url}`;
  }
  if (decision.kind === "conflict") {
    return [
      `${mr} has merge conflicts with ${target} at ${short(snapshot.head)}.`,
      `Update the branch from ${target}, resolve the conflicts with the \`git:conflicts\` skill, and push.`,
    ].join("\n");
  }
  if (decision.kind === "behind") {
    return [
      `${mr} is behind ${target} at ${short(snapshot.head)}, and merging requires a rebase.`,
      `Rebase onto ${target}, resolve any conflicts with the \`git:conflicts\` skill, and push.`,
    ].join("\n");
  }
  if (decision.kind === "push.foreign") {
    return [
      `${mr}'s branch moved from ${short(decision.from)} to ${short(snapshot.head)}, a commit this checkout does not have.`,
      "Pull it before committing or pushing again.",
    ].join("\n");
  }
  return [
    `Pipeline failed on ${mr} at ${short(snapshot.head)}: ${decision.failed.map(shown).join(", ")}.`,
    `Read the failure with \`glab ci get --merge-request=${snapshot.mr} --status=failed\` and \`glab ci trace <job> --pipeline-id ${snapshot.pipeline}\`.`,
  ].join("\n");
}

export function messageOf(snapshot: Snapshot, promoted: Promoted[]): string {
  const mr = `MR !${snapshot.mr}`;
  const paragraphs: string[] = [];
  const feedback: string[] = [];
  for (const decision of promoted) {
    if (decision.kind === "changes_requested") feedback.push(`Changes were requested on ${mr}`);
    else if (decision.kind === "feedback") feedback.push(feedbackLineOf(mr, decision));
    else paragraphs.push(paragraphOf(snapshot, decision));
  }
  if (feedback.length > 0) {
    paragraphs.push(
      [
        ...feedback,
        snapshot.url,
        `Read the discussion with \`glab mr view ${snapshot.mr} --comments\`.`,
      ].join("\n"),
    );
  }
  if (isOpen(snapshot)) {
    paragraphs.push(
      "The gitlab plugin watches this MR's pipeline, reviews, comments, and mergeability, so polling them is unnecessary.",
    );
  }
  return paragraphs.join("\n\n");
}

/** Whom the MR waits on, which leads the footer. */
export type Ball = "author" | "reviewer" | "merging" | "ci" | "none";

// Anything the author can fix outranks a reviewer, who outranks a merge that
// would wait on them anyway. An approval nobody was asked for, or a green MR
// nothing will merge, is the author's.
export function ballOf(snapshot: Snapshot): Ball {
  if (!isOpen(snapshot)) return "none";
  if (snapshot.state === "locked") return "merging";
  const { turn } = turnOf(snapshot);
  const isFixable = isBlocked(snapshot.block) || snapshot.phase === "failing";
  const isUnasked = turn === "none" && snapshot.approvalsLeft > 0;
  if (isFixable || isUnasked || turn === "author" || snapshot.threads > 0) return "author";
  if (turn === "reviewer") return "reviewer";
  if (snapshot.merging.kind !== "none") return "merging";
  return snapshot.phase === "pending" ? "ci" : "author";
}

// Nerd Font Octicons, keyed by glyph name: nf-oct-git_merge is gitMerge.
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
  merged: `${OCT.gitMerge} merged`,
  closed: `${OCT.gitPullRequestClosed} closed`,
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
  none: ({ approvalsLeft: left }) => (left > 0 ? `${OCT.eye} ${left}` : undefined),
};

function mergingPart(merging: Merging): string | undefined {
  if (merging.kind === "queued") return `${OCT.gitMergeQueue} ${merging.position}`;
  return merging.kind === "auto" ? OCT.gitMerge : undefined;
}

// The footer already links the MR, so the state rides after it on that line.
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
