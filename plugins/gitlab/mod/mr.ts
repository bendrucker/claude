export interface MrView {
  iid: number;
  projectId: number;
  url: string;
  state: string;
  sha: string;
  detailedMergeStatus: string | null;
  pipeline: { id: number; projectId: number; status: string } | null;
}

export interface Approvals {
  approvalsRequired: number;
  approvalsLeft: number;
  approvedBy: string[];
}

export interface Note {
  id: number;
  author: string;
  isSystem: boolean;
}

export interface Job {
  id: number;
  name: string;
  status: string;
  allowFailure: boolean;
}

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

const readView: Reader<MrView> = map(
  obj({
    iid: num,
    project_id: num,
    web_url: str,
    state: str,
    sha: str,
    detailed_merge_status: or(str, null),
    head_pipeline: or(readPipeline, null),
  }),
  (v) => ({
    iid: v.iid,
    projectId: v.project_id,
    url: v.web_url,
    state: v.state,
    sha: v.sha,
    detailedMergeStatus: v.detailed_merge_status,
    pipeline: v.head_pipeline,
  }),
);

const readApprovals: Reader<Approvals> = map(
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

const readNotes: Reader<Note[]> = list(
  map(obj({ id: num, author: or(readUsername, "someone"), system: or(bool, false) }), (n) => ({
    id: n.id,
    author: n.author,
    isSystem: n.system,
  })),
);

const readJobs: Reader<Job[]> = list(
  map(obj({ id: num, name: or(str, "job"), status: str, allow_failure: or(bool, false) }), (j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    allowFailure: j.allow_failure,
  })),
);

/** Narrows `glab mr view -F json` output to an MrView, or undefined when it is not one. */
export const parseView = (stdout: string): MrView | undefined => decoded(stdout, readView);
export const parseApprovals = (stdout: string): Approvals | undefined =>
  decoded(stdout, readApprovals);
export const parseNotes = (stdout: string): Note[] | undefined => decoded(stdout, readNotes);
export const parseJobs = (stdout: string): Job[] | undefined => decoded(stdout, readJobs);
export const parseUser = (stdout: string): string | undefined => decoded(stdout, readUsername);

export type Phase = "none" | "pending" | "passing" | "failing";

export interface Snapshot {
  mr: number;
  projectId: number;
  url: string;
  state: string;
  head: string;
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

export type Decision =
  | { action: "promote"; kind: "ci.failed"; failed: string[] }
  | { action: "promote"; kind: "review"; author: string; state: "approved" | "unapproved" }
  | { action: "promote"; kind: "review"; author: string; state: "commented"; notes: number }
  | { action: "promote"; kind: "review"; state: "changes_requested" }
  | { action: "drop"; kind: "ci.passing" | "ci.pending" | "ci.none" }
  | { action: "drop"; kind: "push"; from: string }
  | { action: "drop"; kind: "approvals.reset"; authors: string[] }
  | { action: "drop"; kind: "mr.closed" | "mr.merged" };

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
}

function phaseOf(read: Read, failed: string[], pending: number): Phase {
  const pipeline = read.view.pipeline;
  if (pipeline === null) return "none";
  if (failed.length > 0) return "failing";
  if (pending > 0 || PIPELINE_PENDING.has(pipeline.status)) return "pending";
  if (pipeline.status === "canceled" || pipeline.status === "skipped") return "none";
  return "passing";
}

export function snapshotOf(read: Read): Snapshot {
  const { view, approvals, notes, jobs, me } = read;
  const failed: string[] = [];
  let pending = 0;
  for (const job of jobs) {
    if (job.status === "failed" && !job.allowFailure) failed.push(flatten(job.name));
    else if (PENDING.has(job.status)) pending += 1;
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

function reviewsOf(prev: Snapshot, next: Snapshot, isSameHead: boolean): Decision[] {
  const decisions: Decision[] = [];
  const before = new Set(prev.approvers);
  const after = new Set(next.approvers);
  for (const author of next.approvers) {
    if (!before.has(author))
      decisions.push({ action: "promote", kind: "review", author, state: "approved" });
  }
  const removed = prev.approvers.filter((author) => !after.has(author));
  // A push can reset approvals, which no reviewer did.
  if (removed.length > 0 && !isSameHead) {
    decisions.push({ action: "drop", kind: "approvals.reset", authors: removed });
  } else {
    for (const author of removed) {
      decisions.push({ action: "promote", kind: "review", author, state: "unapproved" });
    }
  }

  // GitLab names no reviewer for a request for changes.
  if (next.isChangesRequested && !prev.isChangesRequested) {
    decisions.push({ action: "promote", kind: "review", state: "changes_requested" });
  }

  const byAuthor = new Map<string, number>();
  for (const note of next.notes.toSorted((a, b) => a.id - b.id)) {
    if (note.id > prev.noteCursor) byAuthor.set(note.author, (byAuthor.get(note.author) ?? 0) + 1);
  }
  for (const [author, notes] of byAuthor) {
    decisions.push({ action: "promote", kind: "review", author, state: "commented", notes });
  }
  return decisions;
}

/**
 * What changed between two polls of the same MR. A job that newly fails, or
 * any new approval, unapproval, request for changes, or comment from someone
 * else, is promoted.
 * Every other change is dropped.
 */
export function decide(prev: Snapshot, next: Snapshot): Decision[] {
  if (!isOpen(next)) {
    if (!isOpen(prev)) return [];
    return [{ action: "drop", kind: next.state === "merged" ? "mr.merged" : "mr.closed" }];
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

  decisions.push(...reviewsOf(prev, next, isSameHead));
  return decisions;
}

const short = (sha: string) => sha.slice(0, 7);

function listed(labels: string[], max = 3): string {
  const head = labels.slice(0, max).map(shown).join(", ");
  return labels.length > max ? `${head} (+${labels.length - max})` : head;
}

function reviewLineOf(mr: string, decision: Extract<Promoted, { kind: "review" }>): string {
  if (decision.state === "changes_requested") return `Changes were requested on ${mr}`;
  if (decision.state === "commented") {
    const comments = decision.notes === 1 ? "1 new comment" : `${decision.notes} new comments`;
    return `@${decision.author} commented on ${mr} (${comments})`;
  }
  if (decision.state === "approved") return `@${decision.author} approved ${mr}`;
  return `@${decision.author} revoked their approval of ${mr}`;
}

function paragraphOf(snapshot: Snapshot, decision: Promoted): string {
  const mr = `MR !${snapshot.mr}`;
  if (decision.kind === "ci.failed") {
    return [
      `Pipeline failed on ${mr} at ${short(snapshot.head)}: ${decision.failed.map(shown).join(", ")}.`,
      `Read the failure with \`glab ci get --merge-request=${snapshot.mr} --status=failed\` and \`glab ci trace <job> --pipeline-id ${snapshot.pipeline}\`.`,
    ].join("\n");
  }
  return [
    `${reviewLineOf(mr, decision)}: ${snapshot.url}`,
    `Read the discussion with \`glab mr view ${snapshot.mr} --comments\`.`,
  ].join("\n");
}

export function messageOf(snapshot: Snapshot, promoted: Promoted[]): string {
  const paragraphs = promoted.map((decision) => paragraphOf(snapshot, decision));
  paragraphs.push(
    "The gitlab plugin watches this MR's pipeline and reviews, so polling them is unnecessary.",
  );
  return paragraphs.join("\n\n");
}

// Nerd Font Octicons.
export const STALE = "\u{f421} stale";

const ENDED: Partial<Record<string, string>> = {
  merged: "\u{f419} merged",
  closed: "\u{f4dc} closed",
};

const CHECKS: Record<Phase, (snapshot: Snapshot) => string | undefined> = {
  none: () => undefined,
  pending: (s) => `\u{f444} CI ${s.total - s.pending}/${s.total}`,
  passing: () => "\u{f49e} CI",
  failing: (s) => `\u{f52f} ${listed(s.failed)}`,
};

function reviewOf(snapshot: Snapshot): string | undefined {
  if (snapshot.isChangesRequested) return "\u{f4d2} changes requested";
  if (snapshot.approvalsLeft > 0) {
    const left = snapshot.approvalsLeft;
    return `\u{f441} ${left} ${left === 1 ? "approval" : "approvals"} needed`;
  }
  return snapshot.isApproved ? "\u{f42e} approved" : undefined;
}

// The footer already links the MR, so the state rides after it on that line.
export function statusOf(snapshot: Snapshot): string {
  const ended = ENDED[snapshot.state];
  if (ended !== undefined) return ended;
  return [CHECKS[snapshot.phase](snapshot), reviewOf(snapshot)]
    .filter((part) => part !== undefined)
    .join(" · ");
}
