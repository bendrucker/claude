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
  obj({ id: num, author: or(readUsername, "someone"), system: or(bool, false) }),
  (n) => ({ id: n.id, author: n.author, isSystem: n.system }),
);

const readJob = map(
  obj({ id: num, name: or(str, "job"), status: str, allow_failure: or(bool, false) }),
  (j) => ({ id: j.id, name: j.name, status: j.status, allowFailure: j.allow_failure }),
);

export type MrView = Out<typeof readView>;
export type Approvals = Out<typeof readApprovals>;
export type Note = Out<typeof readNote>;
export type Job = Out<typeof readJob>;

/** Narrows `glab mr view -F json` output to an MrView, or undefined when it is not one. */
export const parseView = (stdout: string): MrView | undefined => decoded(stdout, readView);
export const parseApprovals = (stdout: string): Approvals | undefined =>
  decoded(stdout, readApprovals);
export const parseNotes = (stdout: string): Note[] | undefined => decoded(stdout, list(readNote));
// `glab api --paginate --output ndjson` prints one job per line across every page.
export const parseJobs = (stdout: string): Job[] | undefined =>
  decoded(`[${stdout.split("\n").filter(Boolean).join(",")}]`, list(readJob));
export const parseUser = (stdout: string): string | undefined => decoded(stdout, readUsername);

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
  isChangesRequested: boolean;
  isApproved: boolean;
  approvalsLeft: number;
  approvers: string[];
  noteCursor: number;
  notes: { id: number; author: string }[];
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
  me: string;
  isHeadKnown: boolean;
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

export function snapshotOf(read: Read): Snapshot {
  const { view, approvals, notes, jobs, me } = read;
  const failed: string[] = [];
  let pending = 0;
  const isManual = view.pipeline?.status === "manual";
  for (const job of jobs) {
    if (job.status === "failed" && !job.allowFailure) failed.push(flatten(job.name));
    else if (PENDING.has(job.status) || (isManual && job.status === "manual")) pending += 1;
  }
  // A failed downstream pipeline fails its trigger job, which the jobs list leaves out.
  if (view.pipeline?.status === "failed" && failed.length === 0) failed.push("pipeline");
  failed.sort();
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
    isChangesRequested: view.detailedMergeStatus === "requested_changes",
    isApproved: approvals.approvedBy.length > 0 && approvals.approvalsLeft === 0,
    approvalsLeft: approvals.approvalsLeft,
    approvers: approvals.approvedBy.filter((name) => name !== me).toSorted(),
    noteCursor: Math.max(0, ...notes.map((n) => n.id)),
    notes: notes
      .filter((n) => !n.isSystem && n.author !== me)
      .map(({ id, author }) => ({ id, author })),
  };
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

function listed(labels: string[], max = 3): string {
  const head = labels.slice(0, max).map(shown).join(", ");
  return labels.length > max ? `${head} (+${labels.length - max})` : head;
}

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

// Nerd Font Octicons, keyed by glyph name: nf-oct-git_merge is gitMerge.
const OCT = {
  alert: "\u{f421}",
  check: "\u{f42e}",
  checkCircle: "\u{f49e}",
  dotFill: "\u{f444}",
  eye: "\u{f441}",
  fileDiff: "\u{f4d2}",
  gitCompare: "\u{f47f}",
  gitMerge: "\u{f419}",
  gitPullRequestClosed: "\u{f4dc}",
  xCircle: "\u{f52f}",
};

export const STALE = `${OCT.alert} stale`;

const BLOCKS: Record<Block, string | undefined> = {
  conflict: `${OCT.gitCompare} conflicts`,
  behind: `${OCT.gitCompare} behind`,
  none: undefined,
};

const ENDED: Partial<Record<string, string>> = {
  merged: `${OCT.gitMerge} merged`,
  closed: `${OCT.gitPullRequestClosed} closed`,
};

const CHECKS: Record<Phase, (snapshot: Snapshot) => string | undefined> = {
  none: () => undefined,
  pending: (s) => `${OCT.dotFill} CI ${s.total - s.pending}/${s.total}`,
  passing: () => `${OCT.checkCircle} CI`,
  failing: (s) => `${OCT.xCircle} ${listed(s.failed)}`,
};

function reviewOf(snapshot: Snapshot): string | undefined {
  if (snapshot.isChangesRequested) return `${OCT.fileDiff} changes requested`;
  if (snapshot.approvalsLeft > 0) {
    const left = snapshot.approvalsLeft;
    return `${OCT.eye} ${left} ${left === 1 ? "approval" : "approvals"} needed`;
  }
  return snapshot.isApproved ? `${OCT.check} approved` : undefined;
}

// The footer already links the MR, so the state rides after it on that line.
export function statusOf(snapshot: Snapshot): string {
  const ended = ENDED[snapshot.state];
  if (ended !== undefined) return ended;
  return [BLOCKS[snapshot.block ?? "none"], CHECKS[snapshot.phase](snapshot), reviewOf(snapshot)]
    .filter((part) => part !== undefined)
    .join(" · ");
}
