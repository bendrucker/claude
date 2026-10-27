import type { EngineInterface, On, PluginOptions, Timer } from "claude-code";
import { drawPane, MUTED, PANE, REFRESH } from "./pane.tsx";
import {
  type Noise,
  type Approvals,
  type Discussion,
  type Job,
  type Merging,
  type MrView,
  type Note,
  type Promoted,
  type Reviewer,
  type Snapshot,
  type Span,
  baselineOf,
  combine,
  decide,
  isOpen,
  messageOf,
  noiseOf,
  parseApprovals,
  parseDiscussions,
  parseJobs,
  parseMerge,
  parseNotes,
  parseReviewers,
  parseUser,
  parseView,
  snapshotOf,
  statusOf,
  turnOf,
} from "./mr.ts";

const MOD = "gitlab";

export const POLL_MS = {
  pending: 60_000,
  settled: 180_000,
  idle: 120_000,
  closed: 600_000,
  error: 300_000,
} as const;

// One ticker polls whenever the wall-clock due time has passed, so a sleep or a
// lost dispatch delays the watch by at most a tick instead of ending it.
export const TICK_MS = 60_000;
// The wait after each further unchanged poll, until a change or a turn.
export const QUIET_MS = [3, 6, 12, 30, 60, 120].map((minutes) => minutes * 60_000);
export const BACKOFF_CAP_MS = QUIET_MS.at(-1) ?? 0;
// An MR opened elsewhere shows up within this long, even on an idle session.
export const IDLE_CAP_MS = 10 * 60_000;
// A gap this long between ticks means the host slept or the ticker died.
const LATE_MS = 3 * TICK_MS;
// A poll in flight this long lost a dispatch, so the next tick polls anyway.
const STUCK_MS = 5 * 60_000;
// A resolved thread may leave updated_at alone, so a full read runs this often.
const FULL_EVERY_MS = 30 * 60_000;

// A dropped injection is retried on later polls, up to this many attempts.
export const MAX_ATTEMPTS = 3;
// Fallback default branches when origin/HEAD is unset.
const DEFAULT_BRANCHES = new Set(["main", "master"]);
// /clear and /resume keep the process running, so the watch continues.
const CONTINUING = new Set(["clear", "resume"]);

interface Undelivered {
  head: string;
  decisions: Promoted[];
  attempts: number;
}

/** The reads beside the MR view, kept while the gate on that view holds. */
interface Feedback {
  gate: string;
  approvals: Approvals;
  notes: Note[];
  discussions: Discussion[];
  jobs: Job[];
}

/** The last answer to a GraphQL read, and the key that refetches it. */
interface Held<T> {
  key?: string;
  value?: T;
}

interface Watch {
  snapshot: Snapshot | undefined;
  branch: string | undefined;
  feedback: Feedback | undefined;
  /** When approvals, notes, and jobs were last read in full. */
  fullAt: number;
  /** The last review state read, refetched only when `key` changes. */
  graphs: { reviewers: Held<Reviewer[]>; merging: Held<Merging> };
  me: string | undefined;
  noise: Noise;
  undelivered: Undelivered | undefined;
  /** What was muted since the last send, which the next send logs beside it. */
  held: string[];
  error: string | undefined;
  /** Failed polls in a row, which stretch the wait so a rate limit can reset. */
  errors: number;
  ticker: Timer | undefined;
  tickedAt: number | undefined;
  polledAt: number;
  due: number;
  pollingSince: number | undefined;
  /** Counts polls started, so one that a stuck poll's successor overtook is discarded. */
  polls: number;
  /** Unchanged polls in a row. */
  streak: number;
  /** Why the last poll found no MR, and on which branch. */
  none: string | undefined;
  /** This session's turns by id, any agent's, to tell its notes from the person's. */
  turns: Map<string, Span>;
  line: string | undefined;
  /** How the last successful poll read the MR. */
  via: Via | undefined;
  isMutedOpen: boolean;
  generation: number;
  isStopped: boolean;
}

/** A gate that matched the last read, one that missed and read in full, or no gate. */
type Via = "hit" | "miss" | "full";

type Read =
  | { kind: "none"; reason: string; branch: string }
  | {
      kind: "mr";
      snapshot: Snapshot;
      branch: string;
      read: Via;
      /** What the read caches, kept only if no newer poll overtook it. */
      feedback?: Feedback;
    };

function show($: EngineInterface, watch: Watch, text: string | undefined) {
  const line = text === "" ? undefined : text;
  if (line === watch.line) return;
  watch.line = line;
  $.ui.invalidate("ui.render");
}

// Any running turn, the main agent's or a subagent's, is the agent at work.
const isBusy = (watch: Watch) => [...watch.turns.values()].some(([, end]) => end === undefined);

function render($: EngineInterface, watch: Watch) {
  if (watch.snapshot === undefined) {
    show($, watch, undefined);
    return;
  }
  show($, watch, statusOf(watch.snapshot, isBusy(watch), watch.error !== undefined));
}

function emit($: EngineInterface, event: string, detail: Record<string, unknown>, ok = true) {
  void $.modEvents.emit({ mod: MOD, event, ok, detail });
}

async function isDefaultBranch($: EngineInterface, cwd: string, branch: string): Promise<boolean> {
  const origin = await $.process.run(
    ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd },
  );
  if (origin.exitCode !== 0) return DEFAULT_BRANCHES.has(branch);
  return origin.stdout.trim() === `origin/${branch}`;
}

const NO_MR = /no (open )?merge request/i;
// glab's answer in a checkout whose remotes are on another forge.
const FOREIGN = /none of the git remotes .* known GitLab host/i;

// glab resolves the host from the git remote, which covers self-managed instances.
async function glab($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  const result = await $.process.run(["glab", ...args], { cwd, timeoutMs: 20_000 });
  if (result.exitCode === 0) return result.stdout;
  // glab opens its stderr with a styled ERROR banner line ahead of the cause.
  const line = result.stderr
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text !== "" && text !== "ERROR");
  throw new Error(line ?? `glab exited ${result.exitCode}`);
}

function parsed<T>(value: T | undefined, source: string): T {
  if (value === undefined) throw new Error(`${source} returned an unexpected shape`);
  return value;
}

// glab mr view finds only an open MR by branch, so a tracked MR is re-read by IID
// to see it merge or close.
async function viewMr(
  $: EngineInterface,
  watch: Watch,
  cwd: string,
  branch: string,
): Promise<string | undefined> {
  try {
    return await glab($, cwd, ["mr", "view", "-F", "json"]);
  } catch (error) {
    if (error instanceof Error && FOREIGN.test(error.message)) return "not gitlab";
    if (!(error instanceof Error && NO_MR.test(error.message))) throw error;
    if (watch.snapshot === undefined || watch.branch !== branch) return undefined;
    return glab($, cwd, ["mr", "view", String(watch.snapshot.mr), "-F", "json"]);
  }
}

async function jobsOf($: EngineInterface, cwd: string, projectId: number, pipeline: number) {
  const path = `projects/${projectId}/pipelines/${pipeline}/jobs?per_page=100`;
  const stdout = await glab($, cwd, ["api", "--paginate", "--output", "ndjson", path]);
  return parsed(parseJobs(stdout), "pipeline jobs");
}

async function feedbackOf(
  $: EngineInterface,
  cwd: string,
  view: MrView,
  gate: string,
): Promise<Feedback> {
  const mr = `projects/${view.projectId}/merge_requests/${view.iid}`;
  const pipeline = view.pipeline;
  const [approvals, notes, discussions, jobs] = await Promise.all([
    glab($, cwd, ["api", `${mr}/approvals`]),
    glab($, cwd, ["api", `${mr}/notes?sort=desc&order_by=created_at&per_page=100`]),
    glab($, cwd, ["api", "--paginate", "--output", "ndjson", `${mr}/discussions?per_page=100`]),
    pipeline === null
      ? Promise.resolve<Job[]>([])
      : jobsOf($, cwd, pipeline.projectId, pipeline.id),
  ]);
  return {
    gate,
    approvals: parsed(parseApprovals(approvals), "MR approvals"),
    notes: parsed(parseNotes(notes), "MR notes"),
    discussions: parsed(parseDiscussions(discussions), "MR discussions"),
    jobs,
  };
}

const REVIEWERS_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      reviewers { nodes { username mergeRequestInteraction { reviewState } } }
    }
  }
}`;

const MERGE_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    ciCdSettings { mergeTrainsEnabled }
    mergeRequest(iid: $iid) { autoMergeEnabled mergeTrainIndex }
  }
}`;

interface Graph<T> {
  query: string;
  event: string;
  parse: (stdout: string) => T | undefined;
  fallback: T;
}

const REVIEWERS: Graph<Reviewer[]> = {
  query: REVIEWERS_QUERY,
  event: "review.read",
  parse: parseReviewers,
  fallback: [],
};

const MERGING: Graph<Merging> = {
  query: MERGE_QUERY,
  event: "merge.read",
  parse: parseMerge,
  fallback: { kind: "none", hasQueue: false },
};

// A review, re-request, reviewer change, auto-merge, or train join leaves a note,
// so GraphQL state is refetched only when the newest note or the head changes.
// A train position can lag until then, as the MRs ahead merge. Only the footer
// reads it, so a failure keeps the last answer rather than failing the poll.
async function graphOf<T>(
  $: EngineInterface,
  cwd: string,
  view: MrView,
  notes: Note[],
  graph: Graph<T>,
  held: Held<T>,
): Promise<T> {
  const key = `${view.projectId}/${view.iid} ${view.sha} ${Math.max(0, ...notes.map((n) => n.id))}`;
  if (held.key === key && held.value !== undefined) return held.value;
  const path = new URL(view.url).pathname.split("/-/")[0]?.slice(1) ?? "";
  const argv = ["api", "graphql", "-f", `query=${graph.query}`, "-f", `path=${path}`];
  const started = await $.clock.now();
  try {
    const stdout = await glab($, cwd, [...argv, "-f", `iid=${view.iid}`]);
    const value = parsed(graph.parse(stdout), graph.event);
    const ms = (await $.clock.now()) - started;
    void $.modEvents.emit({ mod: MOD, event: graph.event, ok: true, ms, detail: { mr: view.iid } });
    held.key = key;
    held.value = value;
    return value;
  } catch (error) {
    const ms = (await $.clock.now()) - started;
    const message = error instanceof Error ? error.message : String(error);
    const detail = { mr: view.iid, error: message };
    void $.modEvents.emit({ mod: MOD, event: graph.event, ok: false, ms, detail });
    const isSameMr = held.key?.startsWith(`${view.projectId}/${view.iid} `) === true;
    return isSameMr && held.value !== undefined ? held.value : graph.fallback;
  }
}

async function meOf($: EngineInterface, watch: Watch, cwd: string): Promise<string> {
  if (watch.me !== undefined) return watch.me;
  watch.me = parsed(parseUser(await glab($, cwd, ["api", "user"])), "glab api user");
  return watch.me;
}

// Every worktree of the repository shares one object store, so only a push from
// another clone or from GitLab itself leaves the head unknown here. Only exit 1
// means a missing object, so a failing git reads as known rather than crying push.
async function isKnown($: EngineInterface, cwd: string, sha: string): Promise<boolean> {
  const argv = ["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`];
  const result = await $.process.run(argv, { cwd });
  return result.exitCode !== 1;
}

// A commit once present stays present, so only a new or missing head is checked again.
async function isHeadKnownOf(
  $: EngineInterface,
  watch: Watch,
  cwd: string,
  sha: string,
): Promise<boolean> {
  const prev = watch.snapshot;
  if (prev?.head === sha && prev.isHeadKnown) return true;
  return isKnown($, cwd, sha);
}

async function readMr(
  $: EngineInterface,
  watch: Watch,
  now: number,
  isRetry = false,
): Promise<Read> {
  const cwd = await $.session.cwd();
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = head.stdout.trim();
  if (head.exitCode !== 0) return { kind: "none", reason: "no git", branch };
  if (branch === "HEAD") return { kind: "none", reason: "detached", branch };
  if (await isDefaultBranch($, cwd, branch)) {
    return { kind: "none", reason: "default branch", branch };
  }
  const stdout = await viewMr($, watch, cwd, branch);
  if (stdout === undefined) return { kind: "none", reason: "no mr", branch };
  if (stdout === "not gitlab") return { kind: "none", reason: stdout, branch };
  const view = parsed(parseView(stdout), "glab mr view");
  const prev = watch.snapshot;
  // A merged or closed MR changes nothing else the watch shows.
  if (prev?.mr === view.iid && !isOpen(prev) && view.state === prev.state) {
    return { kind: "mr", snapshot: prev, branch, read: "hit" };
  }
  // A note, an approval, or a push moves updated_at, so while it and the pipeline
  // hold, the last approvals, notes, and jobs do too. A job can fail before its
  // pipeline does, so one with jobs still running is read in full.
  const gate = `${view.projectId}/${view.iid}@${view.updatedAt} ${view.pipeline?.id}:${view.pipeline?.status}`;
  const held = watch.feedback;
  const isGated =
    held !== undefined &&
    view.updatedAt !== "" &&
    prev?.phase !== "pending" &&
    prev?.pending === 0 &&
    now - watch.fullAt < FULL_EVERY_MS;
  const isCheap = isGated && held.gate === gate;
  const [feedback, me, isHeadKnown] = await Promise.all([
    isCheap ? held : feedbackOf($, cwd, view, gate),
    meOf($, watch, cwd),
    isHeadKnownOf($, watch, cwd, view.sha),
  ]);
  const [reviewers, merging] = await Promise.all([
    graphOf($, cwd, view, feedback.notes, REVIEWERS, watch.graphs.reviewers),
    graphOf($, cwd, view, feedback.notes, MERGING, watch.graphs.merging),
  ]);
  const read = snapshotOf({
    view,
    ...feedback,
    reviewers,
    merging,
    me,
    isHeadKnown,
    noise: watch.noise,
    turns: [...watch.turns.values()],
  });
  // A deleted note can lower the newest id seen, which would re-admit older notes.
  const snapshot =
    prev?.mr === read.mr
      ? { ...read, noteCursor: Math.max(prev.noteCursor, read.noteCursor) }
      : read;
  // The reads are not atomic, so approvals a push reset can look withdrawn on the
  // head read before it.
  if (
    !isRetry &&
    prev?.mr === snapshot.mr &&
    prev.head === snapshot.head &&
    prev.approvers.some((name) => !snapshot.approvers.includes(name))
  ) {
    const recheck = parsed(
      parseView(await glab($, cwd, ["mr", "view", String(view.iid), "-F", "json"])),
      "glab mr view",
    );
    if (recheck.sha !== view.sha) return readMr($, watch, now, true);
  }
  const via: Via = isGated ? "miss" : "full";
  return { kind: "mr", snapshot, branch, read: isCheap ? "hit" : via, feedback };
}

async function inject(
  $: EngineInterface,
  snapshot: Snapshot,
  promoted: Promoted[],
  muted: string[],
  attempt: number,
): Promise<boolean> {
  const text = messageOf(snapshot, promoted);
  const kinds = promoted.map((d) => d.kind);
  const detail = {
    mr: snapshot.mr,
    head: snapshot.head,
    kinds,
    muted,
    chars: text.length,
    attempt,
  };
  try {
    const result = await $.prompt.submit({ text });
    if (result.drop !== undefined) {
      emit($, "inject", { ...detail, dropped: result.drop }, false);
      return false;
    }
    emit($, "inject", detail);
    return true;
  } catch (error) {
    emit($, "inject", { ...detail, error: String(error) }, false);
    return false;
  }
}

interface Due {
  due: Promoted[];
  /** Blocks waiting on the forge to decide mergeability, kept unsent. */
  held: Promoted[];
}

// `decided` is this poll's own mergeability answer, before any carry-forward.
function stillDue(
  undelivered: Undelivered | undefined,
  next: Snapshot,
  decided: Snapshot["block"],
): Due {
  if (undelivered === undefined) return { due: [], held: [] };
  const held: Promoted[] = [];
  const due = undelivered.decisions.flatMap((decision): Promoted[] => {
    if (decision.kind === "mr.merged") return next.state === "merged" ? [decision] : [];
    if (decision.kind === "mr.closed") return next.state === "closed" ? [decision] : [];
    if (!isOpen(next)) return [];
    if (decision.kind === "conflict" || decision.kind === "behind") {
      if (decided === undefined) held.push(decision);
      return decided === decision.kind ? [decision] : [];
    }
    if (decision.kind === "push.foreign") return next.isHeadKnown ? [] : [decision];
    if (decision.kind === "changes_requested") return next.isChangesRequested ? [decision] : [];
    if (decision.kind !== "ci.failed") return [decision];
    if (undelivered.head !== next.head) return [];
    const failed = decision.failed.filter((label) => next.failed.includes(label));
    return failed.length > 0 ? [{ ...decision, failed }] : [];
  });
  return { due, held };
}

// A failed send joins whatever a poll that ran meanwhile left undelivered.
async function send(
  $: EngineInterface,
  watch: Watch,
  next: Snapshot,
  due: Promoted[],
  muted: string[],
  attempt: number,
  isCurrent: () => boolean,
): Promise<void> {
  const isSent = await inject($, next, due, muted, attempt);
  if (!isCurrent() || isSent || attempt >= MAX_ATTEMPTS) return;
  const pending = watch.undelivered;
  watch.undelivered = {
    head: pending?.head ?? next.head,
    decisions: pending === undefined ? due : combine(due, pending.decisions),
    attempts: Math.max(attempt, pending?.attempts ?? 0),
  };
}

function delayOf(snapshot: Snapshot | undefined, streak: number): number {
  const quiet = QUIET_MS[Math.min(streak, QUIET_MS.length) - 1] ?? 0;
  if (snapshot === undefined) return Math.max(POLL_MS.idle, Math.min(quiet, IDLE_CAP_MS));
  if (!isOpen(snapshot)) return Math.max(POLL_MS.closed, quiet);
  // A job still running or a merge in flight lands soon, whatever came before it.
  if (snapshot.phase === "pending" || snapshot.pending > 0) return POLL_MS.pending;
  if (snapshot.merging.kind !== "none" || snapshot.state === "locked") return POLL_MS.settled;
  return Math.max(POLL_MS.settled, quiet);
}

// The streak is kept per MR in session state, so a hot reload resumes the backoff.
async function streakOf($: EngineInterface, snapshot: Snapshot): Promise<number> {
  const { value } = await $.state.get({ plugin: "gitlab", key: "quiet", id: snapshot.url });
  return value ?? 0;
}

function schedule($: EngineInterface, watch: Watch, streak: number, cause: string): void {
  const was = delayOf(watch.snapshot, watch.streak);
  const delay = delayOf(watch.snapshot, streak);
  if (delay !== was) {
    const detail = { mr: watch.snapshot?.mr, streak, delayMs: delay };
    if (streak > 0) emit($, "poll.backoff", detail);
    else emit($, "poll.reset", { ...detail, cause, fromMs: was });
  }
  const url = watch.snapshot?.url;
  if (url !== undefined && streak !== watch.streak) {
    void $.state.set({ plugin: "gitlab", key: "quiet", id: url }, streak);
  }
  watch.streak = streak;
  watch.due = watch.polledAt + delay;
}

// Logs each newly muted item, marking those already there when the MR is first seen.
function mute($: EngineInterface, watch: Watch, prev: Snapshot | undefined, next: Snapshot) {
  const seen = new Set(prev?.muted.map((m) => m.id));
  const fresh = next.muted.filter((m) => !seen.has(m.id));
  const baseline = prev === undefined ? { baseline: true } : {};
  for (const m of fresh) emit($, "muted", { mr: next.mr, head: next.head, ...baseline, ...m });
  if (prev !== undefined) watch.held.push(...fresh.map((m) => m.id));
}

interface Applied {
  isTracked: boolean;
  isChanged: boolean;
}

function apply($: EngineInterface, watch: Watch, read: Read, isCurrent: () => boolean): Applied {
  if (read.kind === "none") {
    const prev = watch.snapshot;
    const none = `${read.reason} ${read.branch}`;
    const isChanged = prev !== undefined || none !== watch.none;
    if (isChanged) emit($, "mr.none", { reason: read.reason, branch: read.branch, from: prev?.mr });
    show($, watch, undefined);
    watch.none = none;
    watch.snapshot = undefined;
    watch.held = [];
    watch.branch = undefined;
    watch.undelivered = undefined;
    return { isTracked: false, isChanged };
  }
  watch.none = undefined;
  const prev = watch.snapshot;
  const isSameMr =
    prev !== undefined &&
    prev.mr === read.snapshot.mr &&
    prev.projectId === read.snapshot.projectId;
  // An undecided poll keeps the last answer, so a recompute does not re-announce a block.
  const decided = read.snapshot.block;
  const next =
    isSameMr && decided === undefined ? { ...read.snapshot, block: prev.block } : read.snapshot;
  let due: Promoted[];
  let attempt = 1;
  let isChanged = true;
  if (!isSameMr) {
    emit($, "mr.tracked", { mr: next.mr, head: next.head, phase: next.phase, state: next.state });
    watch.undelivered = undefined;
    watch.held = [];
    mute($, watch, undefined, next);
    due = baselineOf(next);
    for (const { action, ...detail } of due) {
      emit($, action, { mr: next.mr, head: next.head, baseline: true, ...detail });
    }
  } else {
    mute($, watch, prev, next);
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { mr: next.mr, head: next.head, ...detail });
    }
    isChanged = decisions.length > 0 || statusOf(next) !== statusOf(prev);
    const fresh = decisions.filter((d): d is Promoted => d.action === "promote");
    const still = stillDue(watch.undelivered, next, decided);
    attempt = fresh.length > 0 ? 1 : (watch.undelivered?.attempts ?? 0) + 1;
    watch.undelivered =
      still.held.length > 0
        ? { head: next.head, decisions: still.held, attempts: attempt - 1 }
        : undefined;
    due = combine(still.due, fresh);
  }
  const turn = turnOf(next);
  if (!isSameMr || JSON.stringify(turn) !== JSON.stringify(turnOf(prev))) {
    emit($, "review.turn", { mr: next.mr, head: next.head, ...turn });
  }
  watch.snapshot = next;
  watch.branch = read.branch;
  render($, watch);
  // The send waits for an idle session, so the next poll is not held on it.
  if (due.length > 0) {
    void send($, watch, next, due, watch.held, attempt, isCurrent);
    watch.held = [];
  }
  return { isTracked: !isSameMr, isChanged };
}

async function poll($: EngineInterface, watch: Watch, generation: number, now: number) {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  const seq = ++watch.polls;
  try {
    const read = await readMr($, watch, now);
    if (read.kind === "mr") {
      const ms = (await $.clock.now()) - now;
      const detail = { mr: read.snapshot.mr, read: read.read };
      void $.modEvents.emit({ mod: MOD, event: "poll", ms, detail });
    }
    // A session.end that landed while glab ran has already cleared the status.
    if (!isCurrent() || seq !== watch.polls) return;
    watch.error = undefined;
    watch.errors = 0;
    watch.via = read.kind === "mr" ? read.read : undefined;
    if (read.kind === "mr" && read.feedback !== undefined) {
      if (read.feedback !== watch.feedback) watch.fullAt = now;
      watch.feedback = read.feedback;
    }
    const { isTracked, isChanged } = apply($, watch, read, isCurrent);
    let streak = isChanged ? 0 : watch.streak + 1;
    if (isTracked && watch.snapshot !== undefined) {
      streak = await streakOf($, watch.snapshot);
      watch.streak = streak;
    }
    watch.polledAt = now;
    schedule($, watch, streak, "change");
    // The pane shows the poll times, which move on every poll.
    $.ui.invalidate("ui.render");
  } catch (error) {
    if (!isCurrent() || seq !== watch.polls) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message !== watch.error) emit($, "poll.error", { error: message }, false);
    watch.error = message;
    watch.errors += 1;
    watch.polledAt = now;
    watch.due = now + Math.min(POLL_MS.error * 2 ** (watch.errors - 1), BACKOFF_CAP_MS);
    render($, watch);
  }
}

async function tick($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped || watch.generation !== generation) return;
  const gapMs = now - (watch.tickedAt ?? now);
  watch.tickedAt = now;
  if (gapMs > LATE_MS) {
    const delayMs = watch.due - watch.polledAt;
    emit($, "poll.late", { gapMs, delayMs, lateMs: Math.max(0, now - watch.due) });
  }
  if (watch.pollingSince !== undefined) {
    if (now - watch.pollingSince < STUCK_MS) return;
    emit($, "poll.stuck", { ms: now - watch.pollingSince }, false);
  }
  if (now < watch.due - TICK_MS / 2) return;
  watch.pollingSince = now;
  await poll($, watch, generation, now);
  if (watch.pollingSince === now) watch.pollingSince = undefined;
}

// A refresh skips the cached reads, so it reads everything GitLab has now.
async function refresh($: EngineInterface, watch: Watch): Promise<void> {
  if (watch.isStopped || watch.pollingSince !== undefined) return;
  const now = await $.clock.now();
  emit($, "pane.refresh", { mr: watch.snapshot?.mr });
  watch.fullAt = Number.NEGATIVE_INFINITY;
  watch.pollingSince = now;
  $.ui.invalidate("ui.render");
  await poll($, watch, watch.generation, now);
  if (watch.pollingSince === now) watch.pollingSince = undefined;
  $.ui.invalidate("ui.render");
}

function start($: EngineInterface, watch: Watch): void {
  const generation = watch.generation;
  watch.ticker?.cancel();
  // A restarted ticker's first tick is not late, however long the old one was silent.
  watch.tickedAt = undefined;
  watch.ticker = $.clock.every(TICK_MS, () => void tick($, watch, generation));
  void tick($, watch, generation);
}

// A turn proves the session is awake, so a ticker silent past a few periods has
// died and is started again. A turn also ends a backoff, so the next poll comes
// the unbacked wait after the last one, which sees a push the turn just made.
async function wake($: EngineInterface, watch: Watch): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped) return;
  const silentMs = now - (watch.tickedAt ?? now);
  if (watch.error === undefined && watch.streak > 0) schedule($, watch, 0, "turn");
  // A failing watch retries at the first error wait, not its stretched one.
  else if (watch.error !== undefined)
    watch.due = Math.min(watch.due, watch.polledAt + POLL_MS.error);
  if (silentMs > LATE_MS) {
    emit($, "watch.revived", { silentMs, mr: watch.snapshot?.mr });
    start($, watch);
  }
}

async function hasGlab($: EngineInterface): Promise<boolean> {
  try {
    return (await $.process.run(["glab", "--version"], { timeoutMs: 5000 })).exitCode === 0;
  } catch {
    // run() rejects when glab is not on PATH.
    return false;
  }
}

/**
 * Watches the current branch's merge request with `glab` and shows its pipeline
 * and approval state at the end of the prompt footer. What `decide` promotes is
 * sent to the model, along with a block already present when an MR is first
 * seen. Every other change is only shown and logged.
 */
export function register(on: On, options: PluginOptions): void {
  const { noise, error: noiseError } = noiseOf(
    String(options.reviewers ?? ""),
    String(options.ignore ?? ""),
    String(options.ignoreBody ?? ""),
  );
  const watch: Watch = {
    snapshot: undefined,
    branch: undefined,
    feedback: undefined,
    fullAt: 0,
    graphs: { reviewers: {}, merging: {} },
    me: undefined,
    noise,
    undelivered: undefined,
    held: [],
    error: undefined,
    errors: 0,
    ticker: undefined,
    tickedAt: undefined,
    polledAt: 0,
    due: 0,
    pollingSince: undefined,
    polls: 0,
    streak: 0,
    none: undefined,
    turns: new Map(),
    via: undefined,
    isMutedOpen: false,
    line: undefined,
    generation: 0,
    isStopped: true,
  };

  on("session.start", async ($, e, next) => {
    const generation = watch.generation;
    const started = await next(e);
    if (!e.isInteractive) {
      emit($, "session.start", { active: false, reason: "non-interactive" });
      return started;
    }
    if (options.watch === false) {
      emit($, "session.start", { active: false, reason: "watch off" });
      return started;
    }
    if (!(await hasGlab($))) {
      emit($, "session.start", { active: false, reason: "glab unavailable" });
      return started;
    }
    // A session.end while this start was in flight has moved the generation on.
    if (watch.generation !== generation) return started;
    emit($, "session.start", { active: true });
    // The watch runs without the command, so a refusal only logs.
    $.command
      .register({ name: "mr", description: "Show what the MR watcher sees" })
      .catch((error: unknown) => {
        emit($, "command.register", { error: String(error) }, false);
      });
    if (noiseError !== undefined) emit($, "ignoreBody.invalid", { error: noiseError }, false);
    if (watch.isStopped) {
      watch.isStopped = false;
      watch.me = undefined;
      watch.generation += 1;
      Object.assign(watch, { tickedAt: undefined, due: 0, pollingSince: undefined, streak: 0 });
      start($, watch);
    } else {
      void wake($, watch);
    }
    return started;
  });

  on("ui.render", { component: "PromptHint" }, ($, e, next) => {
    if (watch.line === undefined) return next(e);
    const tail = e.props.tail === undefined ? watch.line : `${e.props.tail} · ${watch.line}`;
    return next({ ...e, props: { ...e.props, tail } });
  });

  on("session.end", ($, e, next) => {
    if (!CONTINUING.has(e.reason)) {
      watch.isStopped = true;
      watch.generation += 1;
      watch.ticker?.cancel();
      show($, watch, undefined);
    }
    return next(e);
  });

  on("command.run", { command: "mr" }, async ($) => {
    // A second /mr closes it: the close mark and its chord do not reach every terminal.
    if ((await $.ui.panes()).some((pane) => pane.id === PANE)) {
      await $.ui.close({ id: PANE });
      emit($, "pane.close", {});
      return {};
    }
    const opened = await $.ui.open({ id: PANE, title: "MR", closeOnEscape: true });
    emit($, "pane.open", { placed: opened.isPlaced, mr: watch.snapshot?.mr });
    return opened.isPlaced ? {} : { text: `/mr: the pane is not drawn (${opened.reason})` };
  }).catch(($, e, next) => {
    emit($, "pane.open", { error: next.error.message }, false);
    return { text: `/mr failed: ${next.error.message ?? next.error.kind}` };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) =>
    drawPane(
      $,
      e,
      { ...watch, isBusy: isBusy(watch), isPolling: watch.pollingSince !== undefined },
      await $.clock.now(),
    ),
  );

  on("ui.press", { plugin: "gitlab" }, ($, e, next) => {
    if (e.element === REFRESH) {
      void refresh($, watch);
      return { element: e.element };
    }
    if (e.element !== MUTED) return next(e);
    watch.isMutedOpen = !watch.isMutedOpen;
    emit($, "pane.muted", { open: watch.isMutedOpen, count: watch.snapshot?.muted.length });
    $.ui.invalidate("ui.render");
    return { element: e.element };
  });

  on("turn.start", async ($, e, next) => {
    // Every span is kept: a full read rescans every note, old ones included.
    watch.turns.set(e.turnId, [await $.clock.now(), undefined]);
    render($, watch);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const span = watch.turns.get(e.turnId);
    if (span !== undefined) span[1] = await $.clock.now();
    render($, watch);
    if (e.agentId === undefined) {
      // Resolving a thread leaves updated_at alone, and a turn often resolves one.
      watch.feedback = undefined;
      void wake($, watch);
    }
    return next(e);
  }).catch(($, e, next) => next(e));
}
