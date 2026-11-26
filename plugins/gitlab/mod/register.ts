import type { EngineInterface, On, PluginOptions, Timer } from "claude-code";
import type { GitlabTracked } from "../types/index.d.ts";
import { type MrRef, bashOf, mrUrlsOf, parseMrCommand, parseMrUrl } from "./discover.ts";
import { type Entry, budgetOf, chipsOf, drawFooter, fit, tailOf } from "./footer.tsx";
import { type View, drawPane, focusOf, MUTED, PANE, REFRESH } from "./pane.tsx";
import {
  type Noise,
  type Approvals,
  type Discussion,
  type Job,
  type Merging,
  type MrView,
  type Named,
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
  ownedOf,
  parseApprovals,
  parseDiscussions,
  parseJobs,
  isMemberOf,
  parseMembers,
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
const BACKOFF_CAP_MS = QUIET_MS.at(-1) ?? 0;
// An MR opened elsewhere shows up within this long, even on an idle session.
export const IDLE_CAP_MS = 10 * 60_000;
// A gap this long between ticks means the host slept or the ticker died.
const LATE_MS = 3 * TICK_MS;
// A poll in flight this long lost a dispatch, so the next tick polls anyway.
const STUCK_MS = 5 * 60_000;
// A resolved thread may leave updated_at alone, so a full read runs this often.
const FULL_EVERY_MS = 30 * 60_000;
// A failed GraphQL read is not retried for the same key until this has passed.
export const GRAPH_RETRY_MS = 5 * 60_000;
// Tracked MRs due on one tick are polled this many at a time.
const POLL_WIDTH = 2;

// A dropped injection is retried on later polls, up to this many attempts.
export const MAX_ATTEMPTS = 3;
// Fallback default branches when origin/HEAD is unset.
const DEFAULT_BRANCHES = new Set(["main", "master"]);
// /clear and /resume keep the process running, so the watch continues.
const CONTINUING = new Set(["clear", "resume"]);

type Origin = "branch" | "created" | "pushed" | "manual";

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
  /** The key whose read failed, and when, so the next polls skip refetching it. */
  failedKey?: string | undefined;
  failedAt?: number;
}

interface Tracked {
  /** Where an MR off the branch is read from, undefined for the branch slot. */
  ref: MrRef | undefined;
  origin: Origin;
  isBranch: boolean;
  snapshot: Snapshot | undefined;
  feedback: Feedback | undefined;
  /** When approvals, notes, and jobs were last read in full. */
  fullAt: number;
  /** A refresh or a turn wants the next poll to skip every cache. */
  isFullDue: boolean;
  /** The last review state read, refetched only when `key` changes. */
  graphs: { reviewers: Held<Reviewer[]>; merging: Held<Merging> };
  undelivered: Undelivered | undefined;
  /** What was muted since the last send, which the next send logs beside it. */
  held: string[];
  error: string | undefined;
  /** Failed polls in a row, which stretch the wait so a rate limit can reset. */
  errors: number;
  polledAt: number;
  due: number;
  pollingSince: number | undefined;
  /** Counts polls started, so one that a stuck poll's successor overtook is discarded. */
  polls: number;
  /** Unchanged polls in a row. */
  streak: number;
  branch: string | undefined;
  /** Why the slot's last poll found no MR, and on which branch. */
  none: string | undefined;
}

interface Watch {
  /** The MR the checkout's branch resolves to, re-resolved on each poll. */
  slot: Tracked;
  /** Every other tracked MR, by `host/projectPath!iid`. */
  others: Map<string, Tracked>;
  /** MRs that merged or closed and stopped being tracked, for the pane. */
  ended: Snapshot[];
  /** The session's username on each host, `""` for the checkout's. */
  me: Map<string, string>;
  /** Whether each `projectId/username` has at least Reporter access, kept for the session. */
  members: Map<string, boolean>;
  noise: Noise;
  ticker: Timer | undefined;
  tickedAt: number | undefined;
  /** This session's turns by id, any agent's, to tell its notes from the person's. */
  turns: Map<string, Span>;
  line: string | undefined;
  /** The footer layout last drawn, so each change is logged once. */
  fits: string | undefined;
  isMutedOpen: boolean;
  generation: number;
  isStopped: boolean;
}

interface Where {
  cwd: string;
  host: string[];
}

/** A gate that matched the last read, one that missed and read in full, or no gate. */
type Via = "hit" | "miss" | "full";

type Polled =
  | { kind: "none"; reason: string; branch: string }
  | {
      kind: "mr";
      snapshot: Snapshot;
      branch: string | undefined;
      read: Via;
      /** What the read caches, kept only if no newer poll overtook it. */
      feedback?: Feedback;
    };

function trackedOf(ref: MrRef | undefined, origin: Origin): Tracked {
  return {
    ref,
    origin,
    isBranch: ref === undefined,
    snapshot: undefined,
    feedback: undefined,
    fullAt: 0,
    isFullDue: false,
    graphs: { reviewers: {}, merging: {} },
    undelivered: undefined,
    held: [],
    error: undefined,
    errors: 0,
    polledAt: 0,
    due: 0,
    pollingSince: undefined,
    polls: 0,
    streak: 0,
    branch: undefined,
    none: undefined,
  };
}

const allOf = (watch: Watch): Tracked[] => [watch.slot, ...watch.others.values()];

const keyOf = (snapshot: Snapshot): string =>
  parseMrUrl(snapshot.url)?.key ?? `${snapshot.projectId}!${snapshot.mr}`;

// Any running turn, the main agent's or a subagent's, is the agent at work.
const isBusy = (watch: Watch) => [...watch.turns.values()].some(([, end]) => end === undefined);

function entriesOf(watch: Watch): Entry[] {
  return allOf(watch).flatMap((t) =>
    t.snapshot === undefined
      ? []
      : [{ snapshot: t.snapshot, isBranch: t.isBranch, isStale: t.error !== undefined }],
  );
}

function render($: EngineInterface, watch: Watch) {
  const tail = tailOf(entriesOf(watch), isBusy(watch));
  const line = tail === "" ? undefined : tail;
  if (line === watch.line) return;
  watch.line = line;
  $.ui.invalidate("ui.render");
}

function emit(
  $: EngineInterface,
  event: string,
  detail: Record<string, unknown>,
  ok = true,
  ms?: number,
) {
  const entry = { mod: MOD, event, ok, detail };
  void $.modEvents.emit(ms === undefined ? entry : { ...entry, ms });
}

// The tracked MRs per session in the plugin's store, so a resumed session keeps them.
const STORE_KEY = "tracked";
const STORE_TTL = 7 * 24 * 60 * 60 * 1000;

type Kept = GitlabTracked[number];
type Stored = Record<string, { at: number; mrs: Kept[] }>;

const isKept = (value: unknown): value is Kept =>
  typeof value === "object" &&
  value !== null &&
  "url" in value &&
  typeof value.url === "string" &&
  "origin" in value &&
  (value.origin === "created" || value.origin === "pushed" || value.origin === "manual");

const isStored = (value: unknown): value is Stored =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "at" in entry &&
      typeof entry.at === "number" &&
      "mrs" in entry &&
      Array.isArray(entry.mrs) &&
      entry.mrs.every(isKept),
  );

async function storedOf($: EngineInterface): Promise<Stored> {
  const value = await $.store.get(STORE_KEY);
  return isStored(value) ? value : {};
}

const viewOf = (watch: Watch): View => ({
  mrs: allOf(watch).map((t) => ({
    snapshot: t.snapshot,
    none: t.none,
    polledAt: t.polledAt,
    due: t.due,
    error: t.error,
    isBranch: t.isBranch,
    isPolling: t.pollingSince !== undefined,
  })),
  ended: watch.ended,
  isMutedOpen: watch.isMutedOpen,
  isBusy: isBusy(watch),
});

async function persist($: EngineInterface, watch: Watch): Promise<void> {
  const kept = allOf(watch).flatMap((t) => {
    const url = t.ref?.url ?? t.snapshot?.url;
    return t.origin === "branch" || url === undefined ? [] : [{ url, origin: t.origin }];
  });
  await $.state.set({ plugin: "gitlab", key: "tracked" }, kept);
  try {
    const [id, now, stored] = await Promise.all([$.session.id(), $.clock.now(), storedOf($)]);
    const fresh = Object.entries(stored).filter(
      ([key, entry]) => key !== id && now - entry.at < STORE_TTL,
    );
    const next: Stored = Object.fromEntries(fresh);
    if (kept.length > 0) next[id] = { at: now, mrs: kept };
    await $.store.set(STORE_KEY, next);
  } catch (error) {
    emit($, "store.error", { op: "set", error: String(error) }, false);
  }
}

async function keptOf($: EngineInterface): Promise<Kept[]> {
  try {
    return (await storedOf($))[await $.session.id()]?.mrs ?? [];
  } catch (error) {
    emit($, "store.error", { op: "get", error: String(error) }, false);
    return [];
  }
}

async function restore($: EngineInterface, watch: Watch): Promise<void> {
  const { value = [] } = await $.state.get({ plugin: "gitlab", key: "tracked" });
  const kept = value.length > 0 ? value : await keptOf($);
  for (const { url, origin } of kept) {
    const ref = parseMrUrl(url);
    if (ref !== undefined && !watch.others.has(ref.key)) {
      watch.others.set(ref.key, trackedOf(ref, origin));
    }
  }
}

async function whereOf($: EngineInterface, t: Tracked): Promise<Where> {
  const cwd = await $.session.cwd();
  return { cwd, host: t.ref === undefined ? [] : ["--hostname", t.ref.host] };
}

const viewArgs = (t: Tracked, iid: number): string[] =>
  t.ref === undefined
    ? ["mr", "view", String(iid), "-F", "json"]
    : ["mr", "view", String(iid), "-R", `${t.ref.host}/${t.ref.projectPath}`, "-F", "json"];

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

const api = ($: EngineInterface, where: Where, args: string[]) =>
  glab($, where.cwd, ["api", ...where.host, ...args]);

function parsed<T>(value: T | undefined, source: string): T {
  if (value === undefined) throw new Error(`${source} returned an unexpected shape`);
  return value;
}

// glab mr view finds only an open MR by branch, so a tracked MR is re-read by IID
// to see it merge or close.
type Viewed = { kind: "view"; stdout: string } | { kind: "foreign" } | { kind: "none" };

async function viewMr(
  $: EngineInterface,
  t: Tracked,
  cwd: string,
  branch: string,
): Promise<Viewed> {
  try {
    return { kind: "view", stdout: await glab($, cwd, ["mr", "view", "-F", "json"]) };
  } catch (error) {
    if (error instanceof Error && FOREIGN.test(error.message)) return { kind: "foreign" };
    if (!(error instanceof Error && NO_MR.test(error.message))) throw error;
    if (t.snapshot === undefined || t.branch !== branch) return { kind: "none" };
    const stdout = await glab($, cwd, viewArgs(t, t.snapshot.mr));
    return { kind: "view", stdout };
  }
}

async function jobsOf($: EngineInterface, where: Where, projectId: number, pipeline: number) {
  const path = `projects/${projectId}/pipelines/${pipeline}/jobs?per_page=100`;
  const stdout = await api($, where, ["--paginate", "--output", "ndjson", path]);
  return parsed(parseJobs(stdout), "pipeline jobs");
}

async function feedbackOf(
  $: EngineInterface,
  where: Where,
  view: MrView,
  gate: string,
): Promise<Feedback> {
  const mr = `projects/${view.projectId}/merge_requests/${view.iid}`;
  const pipeline = view.pipeline;
  const [approvals, notes, discussions, jobs] = await Promise.all([
    api($, where, [`${mr}/approvals`]),
    api($, where, [`${mr}/notes?sort=desc&order_by=created_at&per_page=100`]),
    api($, where, ["--paginate", "--output", "ndjson", `${mr}/discussions?per_page=100`]),
    pipeline === null
      ? Promise.resolve<Job[]>([])
      : jobsOf($, where, pipeline.projectId, pipeline.id),
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
  where: Where,
  view: MrView,
  notes: Note[],
  graph: Graph<T>,
  held: Held<T>,
): Promise<T> {
  const key = `${view.projectId}/${view.iid} ${view.sha} ${Math.max(0, ...notes.map((n) => n.id))}`;
  if (held.key === key && held.value !== undefined) return held.value;
  const started = await $.clock.now();
  const isSameMr = held.key?.startsWith(`${view.projectId}/${view.iid} `) === true;
  const kept = () => (isSameMr && held.value !== undefined ? held.value : graph.fallback);
  if (held.failedKey === key && started - (held.failedAt ?? 0) < GRAPH_RETRY_MS) return kept();
  try {
    if (view.projectPath === "") throw new Error("the MR view names no project path");
    const argv = ["graphql", "-f", `query=${graph.query}`, "-f", `path=${view.projectPath}`];
    const stdout = await api($, where, [...argv, "-f", `iid=${view.iid}`]);
    const value = parsed(graph.parse(stdout), graph.event);
    emit($, graph.event, { mr: view.iid }, true, (await $.clock.now()) - started);
    held.key = key;
    held.value = value;
    held.failedKey = undefined;
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit($, graph.event, { mr: view.iid, error: message }, false, (await $.clock.now()) - started);
    held.failedKey = key;
    held.failedAt = started;
    return kept();
  }
}

async function meOf($: EngineInterface, watch: Watch, where: Where): Promise<string> {
  const host = where.host.join(" ");
  const known = watch.me.get(host);
  if (known !== undefined) return known;
  const me = parsed(parseUser(await api($, where, ["user"])), "glab api user");
  watch.me.set(host, me);
  return me;
}

// Every worktree of the repository shares one object store, so only a push from
// another clone or from GitLab itself leaves the head unknown here. Only exit 1
// means a missing object, so a failing git reads as known rather than crying push.
async function isKnown($: EngineInterface, cwd: string, sha: string): Promise<boolean> {
  const argv = ["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`];
  const result = await $.process.run(argv, { cwd });
  return result.exitCode !== 1;
}

// A commit once present stays present, so only a new or missing head is checked
// again. An MR off the checkout's branch may live in another repository, so its
// pushes are never foreign.
async function isHeadKnownOf(
  $: EngineInterface,
  t: Tracked,
  cwd: string,
  sha: string,
): Promise<boolean> {
  if (!t.isBranch) return true;
  const prev = t.snapshot;
  if (prev?.head === sha && prev.isHeadKnown) return true;
  return isKnown($, cwd, sha);
}

type Located = { kind: "view"; stdout: string; branch: string | undefined } | Polled;

async function locate($: EngineInterface, t: Tracked, cwd: string): Promise<Located> {
  if (t.ref !== undefined) {
    return { kind: "view", stdout: await glab($, cwd, viewArgs(t, t.ref.iid)), branch: undefined };
  }
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = head.stdout.trim();
  if (head.exitCode !== 0) return { kind: "none", reason: "no git", branch };
  if (branch === "HEAD") return { kind: "none", reason: "detached", branch };
  if (await isDefaultBranch($, cwd, branch)) {
    return { kind: "none", reason: "default branch", branch };
  }
  const viewed = await viewMr($, t, cwd, branch);
  if (viewed.kind === "none") return { kind: "none", reason: "no mr", branch };
  if (viewed.kind === "foreign") return { kind: "none", reason: "not gitlab", branch };
  return { kind: "view", stdout: viewed.stdout, branch };
}

async function readMr(
  $: EngineInterface,
  watch: Watch,
  t: Tracked,
  now: number,
  isRetry = false,
): Promise<Polled> {
  const where = await whereOf($, t);
  const located = await locate($, t, where.cwd);
  if (located.kind !== "view") return located;
  const { branch } = located;
  const view = parsed(parseView(located.stdout), "glab mr view");
  const prev = t.snapshot;
  // A merged or closed MR changes nothing else the watch shows.
  if (
    prev?.mr === view.iid &&
    prev.projectId === view.projectId &&
    !isOpen(prev) &&
    view.state === prev.state
  ) {
    return { kind: "mr", snapshot: prev, branch, read: "hit" };
  }
  // A note, an approval, or a push moves updated_at, so while it and the pipeline
  // hold, the last approvals, notes, and jobs do too. A job can fail before its
  // pipeline does, so one with jobs still running is read in full.
  const gate = `${view.projectId}/${view.iid}@${view.updatedAt} ${view.pipeline?.id}:${view.pipeline?.status}`;
  const held = t.feedback;
  const isGated =
    held !== undefined &&
    view.updatedAt !== "" &&
    prev?.phase !== "pending" &&
    prev?.pending === 0 &&
    !t.isFullDue &&
    now - t.fullAt < FULL_EVERY_MS;
  const isCheap = isGated && held.gate === gate;
  const [feedback, me, isHeadKnown] = await Promise.all([
    isCheap ? held : feedbackOf($, where, view, gate),
    meOf($, watch, where),
    isHeadKnownOf($, t, where.cwd, view.sha),
  ]);
  const [reviewers, merging] = await Promise.all([
    graphOf($, where, view, feedback.notes, REVIEWERS, t.graphs.reviewers),
    graphOf($, where, view, feedback.notes, MERGING, t.graphs.merging),
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
    prev?.mr === read.mr && prev.projectId === read.projectId
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
      parseView(await glab($, where.cwd, viewArgs(t, view.iid))),
      "glab mr view",
    );
    if (recheck.sha !== view.sha) return readMr($, watch, t, now, true);
  }
  const via: Via = isGated ? "miss" : "full";
  return { kind: "mr", snapshot, branch, read: isCheap ? "hit" : via, feedback };
}

// A failed read leaves the author unquoted and uncached. The next send asks again.
async function isMember(
  $: EngineInterface,
  watch: Watch,
  where: Where,
  projectId: number,
  username: string,
): Promise<boolean> {
  const key = `${where.host.join(" ")}${projectId}/${username.toLowerCase()}`;
  const known = watch.members.get(key);
  if (known !== undefined) return known;
  const started = await $.clock.now();
  const path = `projects/${projectId}/members/all?query=${encodeURIComponent(username)}&per_page=100`;
  try {
    const stdout = await api($, where, [path]);
    const is = isMemberOf(parsed(parseMembers(stdout), "project members"), username);
    watch.members.set(key, is);
    emit($, "members.read", { member: is }, true, (await $.clock.now()) - started);
    return is;
  } catch (error) {
    const detail = { error: error instanceof Error ? error.message : String(error) };
    emit($, "members.read", detail, false, (await $.clock.now()) - started);
    return false;
  }
}

/** The lowercased usernames, among those with comments to quote, that are project members. */
async function trustedOf(
  $: EngineInterface,
  watch: Watch,
  where: Where,
  snapshot: Snapshot,
  promoted: Promoted[],
): Promise<Set<string>> {
  const authors = promoted.flatMap((d) =>
    d.kind === "feedback" && d.notes.some(({ body }) => body.trim() !== "") ? [d.author] : [],
  );
  const members = await Promise.all(
    authors.map((author) => isMember($, watch, where, snapshot.projectId, author)),
  );
  return new Set(authors.filter((_, i) => members[i]).map((author) => author.toLowerCase()));
}

// With more than one MR in view, the model needs each message to say which MR it is.
function namedOf(watch: Watch, t: Tracked, snapshot: Snapshot): Named | undefined {
  if (t.isBranch && watch.others.size === 0) return undefined;
  const ref = t.ref ?? parseMrUrl(snapshot.url);
  if (ref === undefined) return undefined;
  return { name: `${ref.projectPath}!${ref.iid}`, repo: `${ref.host}/${ref.projectPath}` };
}

async function inject(
  $: EngineInterface,
  watch: Watch,
  t: Tracked,
  snapshot: Snapshot,
  promoted: Promoted[],
  muted: string[],
  attempt: number,
): Promise<boolean> {
  const where = await whereOf($, t);
  const trusted = await trustedOf($, watch, where, snapshot, promoted);
  const text = messageOf(snapshot, promoted, trusted, namedOf(watch, t, snapshot));
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
  t: Tracked,
  next: Snapshot,
  due: Promoted[],
  muted: string[],
  attempt: number,
  isCurrent: () => boolean,
): Promise<void> {
  const isSent = await inject($, watch, t, next, due, muted, attempt);
  if (!isCurrent() || isSent || attempt >= MAX_ATTEMPTS) return;
  const pending = t.undelivered;
  t.undelivered = {
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

function schedule($: EngineInterface, t: Tracked, streak: number, cause: string): void {
  const was = delayOf(t.snapshot, t.streak);
  const delay = delayOf(t.snapshot, streak);
  if (delay !== was) {
    const detail = { mr: t.snapshot?.mr, streak, delayMs: delay };
    if (streak > 0) emit($, "poll.backoff", detail);
    else emit($, "poll.reset", { ...detail, cause, fromMs: was });
  }
  const url = t.snapshot?.url;
  if (url !== undefined && streak !== t.streak) {
    void $.state.set({ plugin: "gitlab", key: "quiet", id: url }, streak);
  }
  t.streak = streak;
  t.due = t.polledAt + delay;
}

// Logs each newly muted item, marking those already there when the MR is first seen.
function mute($: EngineInterface, t: Tracked, prev: Snapshot | undefined, next: Snapshot) {
  const seen = new Set(prev?.muted.map((m) => m.id));
  const fresh = next.muted.filter((m) => !seen.has(m.id));
  const baseline = prev === undefined ? { baseline: true } : {};
  for (const m of fresh) emit($, "muted", { mr: next.mr, head: next.head, ...baseline, ...m });
  if (prev !== undefined) t.held.push(...fresh.map((m) => m.id));
}

// The slot hands an MR the session created, pushed, or named on to the others
// when the branch moves off it, and takes over an MR already tracked when the
// branch moves onto it, so one MR never holds two caches.
function rehome($: EngineInterface, watch: Watch, read: Polled): void {
  const slot = watch.slot;
  const prev = slot.snapshot;
  const was = prev === undefined ? undefined : keyOf(prev);
  const is = read.kind === "mr" ? keyOf(read.snapshot) : undefined;
  if (was === is) return;
  const { polls, pollingSince, branch, none } = slot;
  if (prev !== undefined && was !== undefined) {
    const ref = parseMrUrl(prev.url);
    if (slot.origin !== "branch" && ref !== undefined) {
      const origin = slot.origin === "manual" ? "manual" : "pushed";
      watch.others.set(was, { ...slot, ref, origin, isBranch: false, pollingSince: undefined });
      Object.assign(slot, trackedOf(undefined, "branch"), { polls, pollingSince, branch, none });
    } else {
      emit($, "mr.untracked", { mr: prev.mr, reason: "branch" });
    }
  }
  const entry = is === undefined ? undefined : watch.others.get(is);
  if (is === undefined || entry === undefined) return;
  watch.others.delete(is);
  // An in-flight poll of the entry is now stale.
  entry.polls += 1;
  Object.assign(slot, {
    ...entry,
    ref: undefined,
    isBranch: true,
    polls,
    pollingSince,
    branch,
    none,
  });
}

interface Applied {
  isTracked: boolean;
  isChanged: boolean;
}

function apply(
  $: EngineInterface,
  watch: Watch,
  t: Tracked,
  read: Polled,
  isCurrent: () => boolean,
): Applied {
  if (read.kind === "none") {
    const prev = t.snapshot;
    const none = `${read.reason} ${read.branch}`;
    const isChanged = prev !== undefined || none !== t.none;
    if (isChanged) emit($, "mr.none", { reason: read.reason, branch: read.branch, from: prev?.mr });
    t.none = none;
    t.snapshot = undefined;
    t.held = [];
    t.branch = read.branch;
    t.undelivered = undefined;
    render($, watch);
    return { isTracked: false, isChanged };
  }
  t.none = undefined;
  const prev = t.snapshot;
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
    const { mr, head, phase, state } = next;
    emit($, "mr.tracked", { mr, head, phase, state, origin: t.origin });
    t.undelivered = undefined;
    t.held = [];
    mute($, t, undefined, next);
    due = baselineOf(next);
    for (const { action, ...detail } of due) {
      emit($, action, { mr: next.mr, head: next.head, baseline: true, ...detail });
    }
  } else {
    mute($, t, prev, next);
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { mr: next.mr, head: next.head, ...detail });
    }
    isChanged = decisions.length > 0 || statusOf(next) !== statusOf(prev);
    const fresh = decisions.filter((d): d is Promoted => d.action === "promote");
    const still = stillDue(t.undelivered, next, decided);
    attempt = fresh.length > 0 ? 1 : (t.undelivered?.attempts ?? 0) + 1;
    t.undelivered =
      still.held.length > 0
        ? { head: next.head, decisions: still.held, attempts: attempt - 1 }
        : undefined;
    due = combine(still.due, fresh);
  }
  const turn = turnOf(next);
  if (!isSameMr || JSON.stringify(turn) !== JSON.stringify(turnOf(prev))) {
    emit($, "review.turn", { mr: next.mr, head: next.head, ...turn });
  }
  t.snapshot = next;
  if (t.isBranch) t.branch = read.branch;
  render($, watch);
  const { sent, withheld } = ownedOf(next, due);
  for (const { action, ...detail } of withheld) {
    emit($, "withheld", { mr: next.mr, head: next.head, ...detail });
  }
  // The send waits for an idle session, so the next poll is not held on it.
  if (sent.length > 0) {
    void send($, watch, t, next, sent, t.held, attempt, isCurrent);
    t.held = [];
  }
  return { isTracked: !isSameMr, isChanged };
}

// An MR off the branch that ended leaves after the poll following the one that
// announced it, once nothing about it waits to be delivered.
function retire($: EngineInterface, watch: Watch, t: Tracked, prev: Snapshot | undefined) {
  const next = t.snapshot;
  if (t.isBranch || next === undefined || prev === undefined) return;
  if (isOpen(prev) || isOpen(next) || t.undelivered !== undefined) return;
  watch.others.delete(keyOf(next));
  watch.ended.push(next);
  emit($, "mr.untracked", { mr: next.mr, reason: "ended", state: next.state });
  void persist($, watch);
  render($, watch);
}

async function poll($: EngineInterface, watch: Watch, t: Tracked, generation: number, now: number) {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  const seq = ++t.polls;
  try {
    const read = await readMr($, watch, t, now);
    if (read.kind === "mr") {
      const detail = { mr: read.snapshot.mr, read: read.read };
      emit($, "poll", detail, true, (await $.clock.now()) - now);
    }
    // A session.end that landed while glab ran has already cleared the status.
    if (!isCurrent() || seq !== t.polls) return;
    if (t.isBranch) rehome($, watch, read);
    const prev = t.snapshot;
    t.error = undefined;
    t.errors = 0;
    if (read.kind === "mr" && read.feedback !== undefined) {
      if (read.read !== "hit") Object.assign(t, { fullAt: now, isFullDue: false });
      t.feedback = read.feedback;
    }
    const { isTracked, isChanged } = apply($, watch, t, read, isCurrent);
    let streak = isChanged ? 0 : t.streak + 1;
    if (isTracked && t.snapshot !== undefined) {
      streak = await streakOf($, t.snapshot);
      t.streak = streak;
    }
    t.polledAt = now;
    schedule($, t, streak, "change");
    retire($, watch, t, prev);
    // The pane shows the poll times, which move on every poll.
    $.ui.invalidate("ui.render");
  } catch (error) {
    if (!isCurrent() || seq !== t.polls) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message !== t.error) emit($, "poll.error", { error: message }, false);
    t.error = message;
    t.errors += 1;
    t.polledAt = now;
    t.due = now + Math.min(POLL_MS.error * 2 ** (t.errors - 1), BACKOFF_CAP_MS);
    render($, watch);
  }
}

// pollingSince marks the poll in flight, for the stuck check and the pane.
async function pollNow(
  $: EngineInterface,
  watch: Watch,
  t: Tracked,
  generation: number,
  now: number,
) {
  t.pollingSince = now;
  $.ui.invalidate("ui.render");
  await poll($, watch, t, generation, now);
  if (t.pollingSince === now) t.pollingSince = undefined;
}

async function pollEach(
  $: EngineInterface,
  watch: Watch,
  due: Tracked[],
  generation: number,
  now: number,
) {
  for (let i = 0; i < due.length; i += POLL_WIDTH) {
    const batch = due.slice(i, i + POLL_WIDTH);
    // Each batch waits on the last, which bounds the glab calls in flight.
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(batch.map((t) => pollNow($, watch, t, generation, now)));
  }
}

// A checkout switching branches would otherwise show the old MR until the next poll is due.
async function isBranchMoved($: EngineInterface, t: Tracked): Promise<boolean> {
  if (t.branch === undefined || t.error !== undefined) return false;
  const cwd = await $.session.cwd();
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return head.exitCode === 0 && head.stdout.trim() !== t.branch;
}

async function isDue($: EngineInterface, t: Tracked, now: number): Promise<boolean> {
  if (t.pollingSince !== undefined) {
    if (now - t.pollingSince < STUCK_MS) return false;
    emit($, "poll.stuck", { ms: now - t.pollingSince }, false);
  }
  if (now >= t.due - TICK_MS / 2) return true;
  return t.isBranch && (await isBranchMoved($, t));
}

async function tick($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped || watch.generation !== generation) return;
  const gapMs = now - (watch.tickedAt ?? now);
  watch.tickedAt = now;
  if (gapMs > LATE_MS) {
    const { due, polledAt } = watch.slot;
    emit($, "poll.late", { gapMs, delayMs: due - polledAt, lateMs: Math.max(0, now - due) });
  }
  const all = allOf(watch);
  const isEach = await Promise.all(all.map((t) => isDue($, t, now)));
  await pollEach(
    $,
    watch,
    all.filter((_, i) => isEach[i]),
    generation,
    now,
  );
}

// A refresh skips the cached reads, so it reads everything GitLab has now.
async function refresh($: EngineInterface, watch: Watch): Promise<void> {
  if (watch.isStopped) return;
  const idle = allOf(watch).filter((t) => t.pollingSince === undefined);
  if (idle.length === 0) return;
  const now = await $.clock.now();
  emit($, "pane.refresh", { mr: watch.slot.snapshot?.mr, count: idle.length });
  for (const t of idle) t.isFullDue = true;
  await pollEach($, watch, idle, watch.generation, now);
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

// A turn ends a backoff, so the next poll comes the unbacked wait after the last
// one, which sees a push the turn just made. A failing MR retries at the first
// error wait, not its stretched one.
function rewind($: EngineInterface, t: Tracked): void {
  if (t.error === undefined && t.streak > 0) schedule($, t, 0, "turn");
  else if (t.error !== undefined) t.due = Math.min(t.due, t.polledAt + POLL_MS.error);
}

// A turn proves the session is awake, so a ticker silent past a few periods has
// died and is started again.
async function wake($: EngineInterface, watch: Watch): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped) return;
  const silentMs = now - (watch.tickedAt ?? now);
  for (const t of allOf(watch)) rewind($, t);
  if (silentMs > LATE_MS) {
    emit($, "watch.revived", { silentMs, mr: watch.slot.snapshot?.mr });
    start($, watch);
  }
}

/** Starts tracking each MR not yet tracked, and returns how many were new. */
function track(watch: Watch, refs: MrRef[], origin: Exclude<Origin, "branch">): number {
  let added = 0;
  for (const ref of refs) {
    const slot = watch.slot;
    if (slot.snapshot !== undefined && keyOf(slot.snapshot) === ref.key) {
      if (slot.origin === "branch") slot.origin = origin;
      continue;
    }
    if (watch.others.has(ref.key)) continue;
    watch.others.set(ref.key, trackedOf(ref, origin));
    added += 1;
  }
  return added;
}

function untrack(watch: Watch, key: string | number): Snapshot | MrRef | undefined {
  const matches = (url: string | undefined, iid: number | undefined) =>
    typeof key === "number" ? iid === key : url !== undefined && parseMrUrl(url)?.key === key;
  const slot = watch.slot;
  if (slot.origin !== "branch" && matches(slot.snapshot?.url, slot.snapshot?.mr)) {
    slot.origin = "branch";
    return slot.snapshot;
  }
  for (const [k, t] of watch.others) {
    if (matches(t.ref?.url, t.ref?.iid)) {
      watch.others.delete(k);
      return t.snapshot ?? t.ref;
    }
  }
  return undefined;
}

async function discover($: EngineInterface, watch: Watch, event: unknown): Promise<void> {
  const bash = bashOf(event);
  if (bash === undefined || watch.isStopped) return;
  const found = mrUrlsOf(bash.command, bash.output);
  if (found.length === 0) return;
  const origin = /\bglab\s+mr\s+(create|new)\b/.test(bash.command) ? "created" : "pushed";
  const count = track(watch, found, origin);
  emit($, "discover", { origin, count, found: found.length });
  await persist($, watch);
  if (count > 0) void tick($, watch, watch.generation);
}

async function mrCommand($: EngineInterface, watch: Watch, args: string) {
  const command = parseMrCommand(args);
  if (command.kind === "invalid") return { text: `/mr: ${command.reason}` };
  if (command.kind === "track") {
    if (track(watch, [command.ref], "manual") === 0) {
      return { text: `/mr: already tracking ${command.ref.url}` };
    }
    emit($, "discover", { origin: "manual", count: 1, found: 1 });
    await persist($, watch);
    void tick($, watch, watch.generation);
    return { text: `/mr: tracking ${command.ref.url}` };
  }
  if (command.kind === "untrack") {
    const removed = untrack(watch, "ref" in command ? command.ref.key : command.iid);
    if (removed === undefined) return { text: `/mr: not tracking ${args.trim().slice(8)}` };
    const iid = "mr" in removed ? removed.mr : removed.iid;
    emit($, "mr.untracked", { mr: iid, reason: "command" });
    await persist($, watch);
    render($, watch);
    return { text: `/mr: stopped tracking ${removed.url}` };
  }
  return undefined;
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
 * Watches the current branch's merge request with `glab`, plus each MR the
 * session creates, pushes, or names with `/mr track`, and shows their pipeline
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
    slot: trackedOf(undefined, "branch"),
    others: new Map(),
    ended: [],
    me: new Map(),
    members: new Map(),
    noise,
    ticker: undefined,
    tickedAt: undefined,
    turns: new Map(),
    isMutedOpen: false,
    line: undefined,
    fits: undefined,
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
      .register({ name: "mr", description: "Show what the MR watcher sees, or track another MR" })
      .catch((error: unknown) => {
        emit($, "command.register", { error: String(error) }, false);
      });
    if (noiseError !== undefined) emit($, "ignoreBody.invalid", { error: noiseError }, false);
    if (watch.isStopped) {
      watch.isStopped = false;
      watch.me.clear();
      watch.generation += 1;
      watch.tickedAt = undefined;
      for (const t of allOf(watch))
        Object.assign(t, { due: 0, pollingSince: undefined, streak: 0 });
      await restore($, watch);
      start($, watch);
    } else {
      void wake($, watch);
    }
    return started;
  });

  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    const entries = entriesOf(watch);
    if (watch.line === undefined || entries.length === 0) return next(e);
    const tail = e.props.tail === undefined ? watch.line : `${e.props.tail} · ${watch.line}`;
    if (e.viewport === undefined) return next({ ...e, props: { ...e.props, tail } });
    const { columns } = e.viewport;
    const budget = budgetOf(columns, e.props.hint);
    const fitted = fit(chipsOf(entries, isBusy(watch), e.props.hint), budget);
    const tiers = fitted.kind === "count" ? "count" : fitted.placed.map((p) => p.tier).join(",");
    const detail = { columns, budget, tiers, rest: 0 };
    if (fitted.kind === "chips") detail.rest = fitted.rest?.count ?? 0;
    const fits = JSON.stringify(detail);
    if (fits !== watch.fits) {
      watch.fits = fits;
      emit($, "footer.fit", detail);
    }
    // Too narrow for the MRs: the engine cuts its own tail at the row's end, where a drawn row would wrap.
    if (fitted.kind === "count") return next({ ...e, props: { ...e.props, tail } });
    return drawFooter($, e, await next(e), fitted);
  });

  on("session.end", ($, e, next) => {
    if (!CONTINUING.has(e.reason)) {
      watch.isStopped = true;
      watch.generation += 1;
      watch.ticker?.cancel();
      watch.line = undefined;
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("classic.PostToolUse", async ($, e, next) => {
    const result = await next(e);
    await discover($, watch, e);
    return result;
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "mr" }, async ($, e) => {
    const answer = await mrCommand($, watch, e.args);
    if (answer !== undefined) return answer;
    // A second /mr closes it: the close mark and its chord do not reach every terminal.
    if ((await $.ui.panes()).some((pane) => pane.id === PANE)) {
      await $.ui.close({ id: PANE });
      emit($, "pane.close", {});
      return {};
    }
    const opened = await $.ui.open({ id: PANE, title: "MR", closeOnEscape: true });
    emit($, "pane.open", { placed: opened.isPlaced, mr: watch.slot.snapshot?.mr });
    return opened.isPlaced ? {} : { text: `/mr: the pane is not drawn (${opened.reason})` };
  }).catch(($, e, next) => {
    emit($, "pane.open", { error: next.error.message }, false);
    return { text: `/mr failed: ${next.error.message ?? next.error.kind}` };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    return drawPane($, e, viewOf(watch), await $.clock.now());
  });

  on("ui.press", { plugin: "gitlab" }, ($, e, next) => {
    if (e.element === REFRESH) {
      void refresh($, watch);
      return { element: e.element };
    }
    if (e.element !== MUTED) return next(e);
    watch.isMutedOpen = !watch.isMutedOpen;
    const focus = focusOf(viewOf(watch).mrs, isBusy(watch));
    emit($, "pane.muted", { open: watch.isMutedOpen, count: focus?.snapshot?.muted.length });
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
      for (const t of allOf(watch)) t.isFullDue = true;
      void wake($, watch);
    }
    return next(e);
  }).catch(($, e, next) => next(e));
}
