import type { EngineInterface, On, PluginOptions, Timer } from "claude-code";
import {
  type Origin,
  type PrRef,
  bashOf,
  parsePrCommand,
  parsePrUrl,
  prUrlsOf,
} from "./discover.ts";
import { type Chip, drawFooter } from "./footer.tsx";
import { drawPane, MUTED, PANE, REFRESH, type Seen } from "./pane.tsx";
import {
  type Noise,
  type Promoted,
  type Snapshot,
  type Span,
  EXTRAS_QUERY,
  type Extras,
  type PrView,
  VIEW_FIELDS,
  baselineOf,
  combine,
  decide,
  messageOf,
  nameOf,
  parseExtras,
  noiseOf,
  ownedOf,
  parseView,
  snapshotOf,
  statusOf,
  statusPartsOf,
  turnOf,
} from "./pr.ts";

const MOD = "github";

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
// A PR opened elsewhere shows up within this long, even on an idle session.
export const IDLE_CAP_MS = 10 * 60_000;
// A gap this long between ticks means the host slept or the ticker died.
const LATE_MS = 3 * TICK_MS;
// A poll in flight this long lost a dispatch, so the next tick polls anyway.
const STUCK_MS = 5 * 60_000;
// Probes miss a resolved thread and a merge queue's progress, so a full read runs this often.
const FULL_EVERY_MS = 30 * 60_000;
// Each tick polls at most this many PRs at once, so a long list spreads its gh calls.
export const PARALLEL = 2;

// A dropped injection is retried on later polls, up to this many attempts.
export const MAX_ATTEMPTS = 3;
// Skipped when origin/HEAD is unset and the real default branch is unknown.
// gh's answer in a checkout whose remotes are on another forge.
const FOREIGN = /none of the git remotes .* known GitHub host/i;
const DEFAULT_BRANCHES = new Set(["main", "master"]);
// /clear and /resume keep the process running, so the watch continues.
const CONTINUING = new Set(["clear", "resume"]);

interface Undelivered {
  head: string;
  decisions: Promoted[];
  attempts: number;
}

/** One pull request the session watches, with its own caches, backoff and delivery. */
interface Tracked {
  /** `host/owner/repo#n`, which a branch slot lacks until it finds a PR. */
  key: string | undefined;
  /** Where a PR away from the branch is read, before its first snapshot. */
  url: string | undefined;
  origin: Origin;
  /** Read through the session's checkout rather than by URL. */
  isBranch: boolean;
  snapshot: Snapshot | undefined;
  /** The last full read, before any carry-forward, which an unchanged probe repeats. */
  last: { cwd: string; branch: string; snapshot: Snapshot } | undefined;
  /** The last ETag per REST path the gate probes. */
  etags: Map<string, string>;
  /** When the last full read ran, which the gate forces again after a while. */
  fullAt: number;
  /** A refresh or a turn wants the next poll to skip every cache. */
  isFullDue: boolean;
  extras: { url: string; extras: Extras } | undefined;
  undelivered: Undelivered | undefined;
  /** What was muted since the last send, which the next send logs beside it. */
  held: string[];
  /** Sends still waiting on the engine, which hold an ended PR in place. */
  sending: number;
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
  /** Why the last poll found no PR, and on which branch. */
  none: string | undefined;
  /** Polls that found the PR ended with nothing left to send. */
  endedPolls: number;
}

interface Ended {
  key: string;
  url: string;
  pr: number;
  state: string;
}

interface Watch {
  branch: Tracked;
  others: Map<string, Tracked>;
  /** PRs retired after they ended, which the pane lists until session end. */
  ended: Ended[];
  /** The login per host, to tell the viewer's own feedback apart. */
  me: Map<string, string>;
  noise: Noise;
  ticker: Timer | undefined;
  tickedAt: number | undefined;
  /** This session's turns by id, any agent's, to tell its posts from the person's. */
  turns: Map<string, Span>;
  /** What the footer draws, and the plain text a surface without a viewport gets. */
  footer: { chips: Chip[]; tail: string } | undefined;
  isMutedOpen: boolean;
  generation: number;
  isStopped: boolean;
}

/** A probe that matched the last read, one that missed and read in full, or no probe. */
type Via = "hit" | "miss" | "full";

type Read =
  | { kind: "none"; reason: string; branch: string }
  | {
      kind: "pr";
      snapshot: Snapshot;
      read: Via;
      changed: string[] | undefined;
      /** What the read caches, kept only if no newer poll overtook it. */
      cache: Pick<Tracked, "last" | "etags">;
    };

function trackedOf(origin: Origin, isBranch: boolean, ref?: PrRef): Tracked {
  return {
    key: ref?.key,
    url: ref?.url,
    origin,
    isBranch,
    snapshot: undefined,
    last: undefined,
    etags: new Map(),
    fullAt: 0,
    isFullDue: false,
    extras: undefined,
    undelivered: undefined,
    held: [],
    sending: 0,
    error: undefined,
    errors: 0,
    polledAt: 0,
    due: 0,
    pollingSince: undefined,
    polls: 0,
    streak: 0,
    none: undefined,
    endedPolls: 0,
  };
}

const entriesOf = (watch: Watch): Tracked[] => [watch.branch, ...watch.others.values()];

const isLive = (watch: Watch, t: Tracked) =>
  t === watch.branch || (t.key !== undefined && watch.others.get(t.key) === t);

const keyOf = (url: string) => parsePrUrl(url)?.key ?? url;

// Several PRs, or one away from the branch, need their repository named.
const isNamedOf = (watch: Watch, t: Tracked) => !t.isBranch || watch.others.size > 0;

// Any running turn, the main agent's or a subagent's, is the agent at work.
const isBusy = (watch: Watch) => [...watch.turns.values()].some(([, end]) => end === undefined);

const needsAuthorOf = (t: Tracked, lead: { text: string } | undefined) =>
  t.snapshot?.state === "OPEN" && (lead?.text === "author" || lead?.text === "agent");

// The branch PR leads, then the rest by number.
function shownOf(watch: Watch): Tracked[] {
  const others = [...watch.others.values()]
    .filter((t) => t.snapshot !== undefined)
    .toSorted((a, b) => (a.snapshot?.pr ?? 0) - (b.snapshot?.pr ?? 0));
  return watch.branch.snapshot === undefined ? others : [watch.branch, ...others];
}

// The PR that most needs the author gets the pane's full detail.
function seenOf(watch: Watch): Seen {
  const busy = isBusy(watch);
  const rank = (t: Tracked) => {
    const lead = t.snapshot && statusPartsOf(t.snapshot, busy).lead;
    if (needsAuthorOf(t, lead)) return 0;
    return t.isBranch ? 1 : 2;
  };
  const shown = shownOf(watch).toSorted((a, b) => rank(a) - rank(b));
  const all = entriesOf(watch);
  return {
    prs: shown.flatMap((t) =>
      t.snapshot === undefined
        ? []
        : [{ snapshot: t.snapshot, error: t.error, isBranch: t.isBranch }],
    ),
    none: watch.branch.none,
    ended: watch.ended.map((pr) => ({ url: pr.url, name: nameOf(pr.url), state: pr.state })),
    polledAt: Math.max(...all.map((t) => t.polledAt)),
    due: Math.min(...all.map((t) => t.due)),
    isMutedOpen: watch.isMutedOpen,
    isBusy: busy,
    isPolling: all.some((t) => t.pollingSince !== undefined),
  };
}

function render($: EngineInterface, watch: Watch) {
  const busy = isBusy(watch);
  const shown = shownOf(watch);
  const chips = shown.flatMap((t): Chip[] => {
    const s = t.snapshot;
    if (s === undefined || t.key === undefined) return [];
    const { lead, parts } = statusPartsOf(s, busy, t.error !== undefined);
    const needsAuthor = needsAuthorOf(t, lead);
    return [
      {
        key: t.key,
        pr: s.pr,
        url: s.url,
        lead,
        parts,
        needsAuthor,
        isBranch: t.isBranch,
        isLabelled: true,
      },
    ];
  });
  const lone = shown.length === 1 && shown[0]?.isBranch === true;
  const tail = shown
    .map((t) => {
      if (t.snapshot === undefined) return "";
      const status = statusOf(t.snapshot, busy, t.error !== undefined);
      return lone ? status : `#${t.snapshot.pr} ${status}`;
    })
    .join(" · ");
  const footer = chips.length === 0 ? undefined : { chips, tail };
  if (JSON.stringify(footer) === JSON.stringify(watch.footer)) return;
  watch.footer = footer;
  $.ui.invalidate("ui.render");
}

function emit($: EngineInterface, event: string, detail: Record<string, unknown>, ok = true) {
  void $.modEvents.emit({ mod: MOD, event, ok, detail });
}

function persist($: EngineInterface, watch: Watch): void {
  const kept = entriesOf(watch).flatMap((t) =>
    t.origin === "branch" || t.snapshot === undefined
      ? []
      : [{ url: t.snapshot.url, origin: t.origin }],
  );
  void $.state.set({ plugin: "github", key: "tracked" }, kept);
}

async function isDefaultBranch($: EngineInterface, cwd: string, branch: string): Promise<boolean> {
  const origin = await $.process.run(
    ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd },
  );
  if (origin.exitCode !== 0) return DEFAULT_BRANCHES.has(branch);
  return origin.stdout.trim() === `origin/${branch}`;
}

// The login only filters the viewer's own feedback, so a token that cannot read
// it leaves that feedback unfiltered rather than failing the poll.
async function meOf(
  $: EngineInterface,
  watch: Watch,
  cwd: string,
  url: string,
): Promise<string | undefined> {
  const host = new URL(url).hostname;
  const known = watch.me.get(host);
  if (known !== undefined) return known;
  const argv = ["gh", "api", "user", "--hostname", host, "--jq", ".login"];
  const user = await $.process.run(argv, { cwd, timeoutMs: 20_000 });
  const login = user.stdout.trim();
  if (user.exitCode !== 0 || login === "") return undefined;
  watch.me.set(host, login);
  return login;
}

// The extras only place quotes and fill the footer and pane, so a failed read
// keeps the last answer for the same PR rather than failing the poll.
async function extrasOf(
  $: EngineInterface,
  t: Tracked,
  cwd: string,
  url: string,
): Promise<Extras | undefined> {
  try {
    const extras = await readExtras($, cwd, url);
    t.extras = { url, extras };
    return extras;
  } catch (error) {
    emit(
      $,
      "extras.read",
      { error: error instanceof Error ? error.message : String(error) },
      false,
    );
    return t.extras?.url === url ? t.extras.extras : undefined;
  }
}

async function readExtras($: EngineInterface, cwd: string, url: string): Promise<Extras> {
  const { hostname, pathname } = new URL(url);
  const [, owner = "", name = "", , pr = ""] = pathname.split("/");
  const argv = ["gh", "api", "graphql", "--hostname", hostname, "-f", `query=${EXTRAS_QUERY}`];
  argv.push("-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `pr=${pr}`);
  const result = await $.process.run(argv, { cwd, timeoutMs: 20_000 });
  if (result.exitCode !== 0) {
    const line = result.stderr.trim().split("\n")[0] ?? "";
    throw new Error(line === "" ? `gh api graphql exited ${result.exitCode}` : line);
  }
  const extras = parseExtras(result.stdout);
  if (extras === undefined) throw new Error("gh api graphql returned an unexpected shape");
  return extras;
}

// Every worktree of the repository shares one object store, so only a push from
// another clone or from GitHub itself leaves the head unknown here. Only exit 1
// means a missing object, so a failing git reads as known rather than crying push.
async function isKnown($: EngineInterface, cwd: string, sha: string): Promise<boolean> {
  const argv = ["git", "rev-parse", "--verify", "--quiet", `${sha}^{commit}`];
  const result = await $.process.run(argv, { cwd });
  return result.exitCode !== 1;
}

// Whether the checkout's origin is the PR's repository, the only one whose commits it holds.
async function isLocalRepo($: EngineInterface, cwd: string, url: string): Promise<boolean> {
  const remote = await $.process.run(["git", "remote", "get-url", "origin"], { cwd });
  if (remote.exitCode !== 0) return false;
  const repo = nameOf(url).split("#")[0]?.toLowerCase() ?? "";
  const path = remote.stdout
    .trim()
    .replace(/\.git$/, "")
    .toLowerCase();
  return path.endsWith(`/${repo}`) || path.endsWith(`:${repo}`);
}

// A commit once present stays present, so only a new or missing head is checked again.
async function isHeadKnownOf(
  $: EngineInterface,
  t: Tracked,
  cwd: string,
  view: PrView,
): Promise<boolean> {
  const prev = t.snapshot;
  if (prev?.head === view.headRefOid && prev.isHeadKnown) return true;
  if (!t.isBranch && !(await isLocalRepo($, cwd, view.url))) return true;
  return isKnown($, cwd, view.headRefOid);
}

interface Probe {
  name: string;
  path: string;
  etag: string | undefined;
  isSame: boolean;
}

// gh exits 1 on a 304, so the status line decides rather than the exit code.
async function probe(
  $: EngineInterface,
  cwd: string,
  host: string,
  [name, path]: [string, string],
  sent: string | undefined,
): Promise<Probe> {
  const argv = ["gh", "api", "-i", "--silent", "--hostname", host, path];
  if (sent !== undefined) argv.push("-H", `If-None-Match: ${sent}`);
  const { stdout } = await $.process.run(argv, { cwd, timeoutMs: 20_000 });
  const isSame = /^HTTP\/\S+ 304\b/.test(stdout);
  // A 304 carries the strong form of a weak ETag, so the one sent is kept.
  const etag = isSame ? sent : /^etag:\s*(.+?)\s*$/im.exec(stdout)?.[1];
  return { name, path, etag, isSame };
}

/**
 * Which of the REST resources behind a snapshot changed since the last probe,
 * and their ETags, kept only once a read has seen what they describe. A 304
 * spends no rate limit, and together they move on a push, a check, a review, a
 * comment, a mergeability answer, and a merge or close.
 */
async function changedOf(
  $: EngineInterface,
  t: Tracked,
  cwd: string,
  prev: Snapshot,
): Promise<{ changed: string[]; etags: Map<string, string> }> {
  const { hostname, pathname } = new URL(prev.url);
  const repo = `repos${pathname.split("/pull/")[0]}`;
  const paths: [string, string][] = [
    ["pull", `${repo}/pulls/${prev.pr}`],
    ["reviews", `${repo}/pulls/${prev.pr}/reviews?per_page=100`],
    ["checks", `${repo}/commits/${prev.head}/check-runs?per_page=100`],
    ["statuses", `${repo}/commits/${prev.head}/status?per_page=100`],
  ];
  const probes = await Promise.all(
    paths.map((entry) => probe($, cwd, hostname, entry, t.etags.get(entry[1]))),
  );
  const etags = new Map(probes.flatMap((p) => (p.etag === undefined ? [] : [[p.path, p.etag]])));
  return { changed: probes.filter((p) => !p.isSame).map((p) => p.name), etags };
}

// A merged or closed PR keeps answering 304, so a new PR on its branch needs the
// full read, as does a mergeability GitHub has yet to decide.
function isProbedOf(t: Tracked, now: number, matches: (last: Snapshot) => boolean): boolean {
  const last = t.last?.snapshot;
  return (
    t.snapshot !== undefined &&
    !t.isFullDue &&
    now - t.fullAt < FULL_EVERY_MS &&
    last !== undefined &&
    matches(last) &&
    last.state === "OPEN" &&
    last.block !== undefined
  );
}

async function readPr($: EngineInterface, watch: Watch, t: Tracked, now: number): Promise<Read> {
  const cwd = await $.session.cwd();
  let branch = "";
  let argv: string[];
  if (t.isBranch) {
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    branch = head.stdout.trim();
    if (head.exitCode !== 0) return { kind: "none", reason: "no git", branch };
    if (branch === "HEAD") return { kind: "none", reason: "detached", branch };
    if (await isDefaultBranch($, cwd, branch)) {
      return { kind: "none", reason: "default branch", branch };
    }
    argv = ["gh", "pr", "view", "--json", VIEW_FIELDS];
  } else {
    const ref = parsePrUrl(t.snapshot?.url ?? t.url ?? "");
    if (ref === undefined) throw new Error(`not a pull request: ${t.key}`);
    argv = ["gh", "pr", "view", String(ref.pr), "-R", `${ref.host}/${ref.owner}/${ref.repo}`];
    argv.push("--json", VIEW_FIELDS);
  }
  const last = t.last;
  const isProbed = isProbedOf(t, now, (snapshot) =>
    t.isBranch ? last?.cwd === cwd && last.branch === branch : keyOf(snapshot.url) === t.key,
  );
  const probed =
    isProbed && last !== undefined ? await changedOf($, t, cwd, last.snapshot) : undefined;
  const changed = probed?.changed;
  if (probed?.changed.length === 0 && last !== undefined) {
    const cache = { last, etags: probed.etags };
    return { kind: "pr", snapshot: last.snapshot, read: "hit", changed, cache };
  }
  const view = await $.process.run(argv, { cwd, timeoutMs: 20_000 });
  if (view.exitCode !== 0) {
    if (t.isBranch && /no pull requests found/i.test(view.stderr)) {
      return { kind: "none", reason: "no pr", branch };
    }
    if (t.isBranch && FOREIGN.test(view.stderr)) {
      return { kind: "none", reason: "not github", branch };
    }
    const line = view.stderr.trim().split("\n")[0] ?? "";
    throw new Error(line === "" ? `gh exited ${view.exitCode}` : line);
  }
  const parsed = parseView(view.stdout);
  if (parsed === undefined) throw new Error("gh pr view returned an unexpected shape");
  const [me, isHeadKnown, extras] = await Promise.all([
    meOf($, watch, cwd, parsed.url),
    isHeadKnownOf($, t, cwd, parsed),
    extrasOf($, t, cwd, parsed.url),
  ]);
  const turns = [...watch.turns.values()];
  const snapshot = snapshotOf(parsed, { me, isHeadKnown, noise: watch.noise, turns, extras });
  const cache = { last: { cwd, branch, snapshot }, etags: probed?.etags ?? t.etags };
  return { kind: "pr", snapshot, read: changed === undefined ? "full" : "miss", changed, cache };
}

async function inject(
  $: EngineInterface,
  snapshot: Snapshot,
  promoted: Promoted[],
  muted: string[],
  attempt: number,
  isNamed: boolean,
): Promise<boolean> {
  const text = messageOf(snapshot, promoted, isNamed);
  const kinds = promoted.map((d) => d.kind);
  const detail = {
    pr: snapshot.pr,
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
    if (decision.kind === "pr.merged") return next.state === "MERGED" ? [decision] : [];
    if (decision.kind === "pr.closed") return next.state === "CLOSED" ? [decision] : [];
    if (next.state !== "OPEN") return [];
    if (decision.kind === "conflict" || decision.kind === "behind") {
      if (decided === undefined) held.push(decision);
      return decided === decision.kind ? [decision] : [];
    }
    if (decision.kind === "push.foreign") return next.isHeadKnown ? [] : [decision];
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
  t.sending += 1;
  const isSent = await inject($, next, due, muted, attempt, isNamedOf(watch, t));
  t.sending -= 1;
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
  if (snapshot.state !== "OPEN") return Math.max(POLL_MS.closed, quiet);
  // A job still running or a merge in flight lands soon, whatever came before it.
  if (snapshot.phase === "pending" || snapshot.pending > 0) return POLL_MS.pending;
  if (snapshot.merging.kind !== "none") return POLL_MS.settled;
  return Math.max(POLL_MS.settled, quiet);
}

// The streak is kept per PR in session state, so a hot reload resumes the backoff.
async function streakOf($: EngineInterface, snapshot: Snapshot): Promise<number> {
  const { value } = await $.state.get({ plugin: "github", key: "quiet", id: snapshot.url });
  return value ?? 0;
}

function schedule($: EngineInterface, t: Tracked, streak: number, cause: string): void {
  const was = delayOf(t.snapshot, t.streak);
  const delay = delayOf(t.snapshot, streak);
  if (delay !== was) {
    const detail = { pr: t.snapshot?.pr, streak, delayMs: delay };
    if (streak > 0) emit($, "poll.backoff", detail);
    else emit($, "poll.reset", { ...detail, cause, fromMs: was });
  }
  const url = t.snapshot?.url;
  if (url !== undefined && streak !== t.streak) {
    void $.state.set({ plugin: "github", key: "quiet", id: url }, streak);
  }
  t.streak = streak;
  t.due = t.polledAt + delay;
}

// Logs each newly muted item, marking those already there when the PR is first seen.
function mute($: EngineInterface, t: Tracked, prev: Snapshot | undefined, next: Snapshot) {
  const seen = new Set(prev?.muted.map((m) => m.id));
  const fresh = next.muted.filter((m) => !seen.has(m.id));
  const baseline = prev === undefined ? { baseline: true } : {};
  for (const m of fresh) emit($, "muted", { pr: next.pr, head: next.head, ...baseline, ...m });
  if (prev !== undefined) t.held.push(...fresh.map((m) => m.id));
}

interface Applied {
  isTracked: boolean;
  isChanged: boolean;
}

function apply(
  $: EngineInterface,
  watch: Watch,
  t: Tracked,
  read: Read,
  isCurrent: () => boolean,
): Applied {
  if (read.kind === "none") {
    const prev = t.snapshot;
    const none = `${read.reason} ${read.branch}`;
    const isChanged = prev !== undefined || none !== t.none;
    if (isChanged) emit($, "pr.none", { reason: read.reason, branch: read.branch, from: prev?.pr });
    t.none = none;
    t.key = undefined;
    t.snapshot = undefined;
    t.held = [];
    t.undelivered = undefined;
    render($, watch);
    return { isTracked: false, isChanged };
  }
  t.none = undefined;
  const prev = t.snapshot;
  const isSamePr = prev !== undefined && prev.url === read.snapshot.url;
  // An undecided poll keeps the last answer, so a recompute does not re-announce a block.
  const decided = read.snapshot.block;
  const next =
    isSamePr && decided === undefined ? { ...read.snapshot, block: prev.block } : read.snapshot;
  let due: Promoted[];
  let attempt = 1;
  let isChanged = true;
  if (!isSamePr) {
    t.key = keyOf(next.url);
    emit($, "pr.tracked", {
      pr: next.pr,
      head: next.head,
      phase: next.phase,
      state: next.state,
      origin: t.origin,
    });
    t.undelivered = undefined;
    t.held = [];
    t.endedPolls = 0;
    mute($, t, undefined, next);
    due = baselineOf(next);
    for (const { action, ...detail } of due) {
      emit($, action, { pr: next.pr, head: next.head, baseline: true, ...detail });
    }
  } else {
    mute($, t, prev, next);
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { pr: next.pr, head: next.head, ...detail });
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
  if (!isSamePr || JSON.stringify(turn) !== JSON.stringify(turnOf(prev))) {
    emit($, "review.turn", { pr: next.pr, head: next.head, ...turn });
  }
  t.snapshot = next;
  render($, watch);
  const { sent, withheld } = ownedOf(next, due);
  for (const { action, ...detail } of withheld) {
    emit($, "withheld", { pr: next.pr, head: next.head, ...detail });
  }
  // The send waits for an idle session, so the next poll is not held on it.
  if (sent.length > 0) {
    void send($, watch, t, next, sent, t.held, attempt, isCurrent);
    t.held = [];
  }
  return { isTracked: !isSamePr, isChanged };
}

// A branch slot holding a PR tracked for another reason hands it back to the
// tracked list, and starts over empty.
function detach(watch: Watch): Tracked {
  const t = watch.branch;
  if (t.key !== undefined) watch.others.set(t.key, t);
  t.isBranch = false;
  t.last = undefined;
  watch.branch = trackedOf("branch", true);
  return watch.branch;
}

/** The entry a branch read lands on, so one PR never holds two caches. */
function homeOf($: EngineInterface, watch: Watch, read: Read): Tracked {
  const t = watch.branch;
  const isKept = t.snapshot !== undefined && t.origin !== "branch";
  if (read.kind === "none") return isKept ? detach(watch) : t;
  const key = keyOf(read.snapshot.url);
  if (key === t.key) return t;
  const adopted = watch.others.get(key);
  if (isKept) detach(watch);
  if (adopted === undefined) return watch.branch;
  if (!isKept && t.snapshot !== undefined) {
    emit($, "pr.untracked", { pr: t.snapshot.pr, reason: "branch" });
  }
  watch.others.delete(key);
  adopted.isBranch = true;
  // Its own poll in flight read by URL, which this read supersedes.
  adopted.polls += 1;
  watch.branch = adopted;
  return adopted;
}

// An ended PR away from the branch leaves the footer a poll after its last send.
function retire($: EngineInterface, watch: Watch, t: Tracked): void {
  const s = t.snapshot;
  if (t.isBranch || s === undefined || t.key === undefined || s.state === "OPEN") return;
  t.endedPolls += 1;
  if (t.endedPolls < 2 || t.undelivered !== undefined || t.sending > 0) return;
  watch.others.delete(t.key);
  watch.ended.push({ key: t.key, url: s.url, pr: s.pr, state: s.state });
  emit($, "pr.untracked", { pr: s.pr, key: t.key, reason: "ended" });
  persist($, watch);
  render($, watch);
}

async function poll($: EngineInterface, watch: Watch, t: Tracked, generation: number, now: number) {
  const seq = ++t.polls;
  const isFresh = () =>
    !watch.isStopped && watch.generation === generation && seq === t.polls && isLive(watch, t);
  try {
    const read = await readPr($, watch, t, now);
    if (read.kind === "pr") {
      const ms = (await $.clock.now()) - now;
      const detail = { pr: read.snapshot.pr, read: read.read, changed: read.changed };
      void $.modEvents.emit({ mod: MOD, event: "poll", ms, detail });
    }
    // A session.end that landed while gh ran has already cleared the status.
    if (!isFresh()) return;
    const home = t.isBranch ? homeOf($, watch, read) : t;
    const isCurrent = () =>
      !watch.isStopped && watch.generation === generation && isLive(watch, home);
    home.error = undefined;
    home.errors = 0;
    if (read.kind === "pr") {
      Object.assign(home, read.cache);
      if (read.read !== "hit") Object.assign(home, { fullAt: now, isFullDue: false });
    }
    const { isTracked, isChanged } = apply($, watch, home, read, isCurrent);
    let streak = isChanged ? 0 : home.streak + 1;
    if (isTracked && home.snapshot !== undefined) {
      streak = await streakOf($, home.snapshot);
      home.streak = streak;
    }
    home.polledAt = now;
    schedule($, home, streak, "change");
    if (home !== t && !isLive(watch, t)) persist($, watch);
    retire($, watch, home);
    // The pane shows the poll times, which move on every poll.
    $.ui.invalidate("ui.render");
  } catch (error) {
    if (!isFresh()) return;
    const message = error instanceof Error ? error.message : String(error);
    if (message !== t.error) emit($, "poll.error", { pr: t.snapshot?.pr, error: message }, false);
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

async function tick($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped || watch.generation !== generation) return;
  const gapMs = now - (watch.tickedAt ?? now);
  watch.tickedAt = now;
  if (gapMs > LATE_MS) {
    const { due, polledAt } = watch.branch;
    emit($, "poll.late", { gapMs, delayMs: due - polledAt, lateMs: Math.max(0, now - due) });
  }
  let inFlight = 0;
  const ready = entriesOf(watch).filter((t) => {
    if (t.pollingSince !== undefined) {
      if (now - t.pollingSince < STUCK_MS) {
        inFlight += 1;
        return false;
      }
      emit($, "poll.stuck", { pr: t.snapshot?.pr, ms: now - t.pollingSince }, false);
    }
    return now >= t.due - TICK_MS / 2;
  });
  const picked = ready.toSorted((a, b) => a.due - b.due).slice(0, Math.max(0, PARALLEL - inFlight));
  await Promise.all(picked.map((t) => pollNow($, watch, t, generation, now)));
}

// A refresh skips the probe, so it reads everything GitHub has now.
async function refresh($: EngineInterface, watch: Watch): Promise<void> {
  if (watch.isStopped) return;
  const now = await $.clock.now();
  const idle = entriesOf(watch).filter((t) => t.pollingSince === undefined);
  if (idle.length === 0) return;
  emit($, "pane.refresh", { prs: idle.flatMap((t) => (t.snapshot ? [t.snapshot.pr] : [])) });
  for (const t of idle) t.isFullDue = true;
  await Promise.all(idle.map((t) => pollNow($, watch, t, watch.generation, now)));
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

// A turn ends a backoff, so the next poll comes the unbacked wait after the
// last one, which sees a push the turn just made.
function unback($: EngineInterface, t: Tracked): void {
  if (t.error === undefined && t.streak > 0) schedule($, t, 0, "turn");
  // A failing watch retries at the first error wait, not its stretched one.
  else if (t.error !== undefined) t.due = Math.min(t.due, t.polledAt + POLL_MS.error);
}

// A turn proves the session is awake, so a ticker silent past a few periods has
// died and is started again.
async function wake($: EngineInterface, watch: Watch): Promise<void> {
  const now = await $.clock.now();
  if (watch.isStopped) return;
  const silentMs = now - (watch.tickedAt ?? now);
  for (const t of entriesOf(watch)) unback($, t);
  if (silentMs > LATE_MS) {
    emit($, "watch.revived", { silentMs, pr: watch.branch.snapshot?.pr });
    start($, watch);
  }
}

/** Adds a PR to the watch, or raises its reason to stay; the reply says which. */
function track(
  $: EngineInterface,
  watch: Watch,
  ref: PrRef,
  origin: Exclude<Origin, "branch">,
): string {
  const name = `${ref.owner}/${ref.repo}#${ref.pr}`;
  const existing = entriesOf(watch).find((t) => t.key === ref.key);
  if (existing !== undefined) {
    if (existing.origin !== "branch") return `Already tracking ${name}`;
    existing.origin = origin;
    persist($, watch);
    return `Tracking ${name}, which stays after the branch moves`;
  }
  const t = trackedOf(origin, false, ref);
  watch.others.set(ref.key, t);
  emit($, "pr.tracking", { key: ref.key, origin });
  if (!watch.isStopped) void pollNow($, watch, t, watch.generation, 0);
  return `Tracking ${name}`;
}

function untrack(
  $: EngineInterface,
  watch: Watch,
  match: (t: Tracked) => boolean,
  label: string,
): string {
  const found = entriesOf(watch).filter((t) => t.key !== undefined && match(t));
  if (found.length === 0) return `Not tracking ${label}`;
  if (found.length > 1) return `${label} matches several PRs; pass its URL`;
  const [t] = found;
  if (t?.key === undefined) return `Not tracking ${label}`;
  if (t.isBranch) {
    t.origin = "branch";
    persist($, watch);
    return `${label} is this branch's PR, so it stays while the branch is checked out`;
  }
  watch.others.delete(t.key);
  emit($, "pr.untracked", { pr: t.snapshot?.pr, key: t.key, reason: "command" });
  persist($, watch);
  render($, watch);
  return `Stopped tracking ${label}`;
}

async function restore($: EngineInterface, watch: Watch): Promise<void> {
  const { value = [] } = await $.state.get({ plugin: "github", key: "tracked" });
  for (const { url, origin } of value) {
    const ref = parsePrUrl(url);
    if (ref !== undefined && !entriesOf(watch).some((t) => t.key === ref.key)) {
      watch.others.set(ref.key, trackedOf(origin, false, ref));
    }
  }
}

async function hasGh($: EngineInterface): Promise<boolean> {
  try {
    return (await $.process.run(["gh", "--version"], { timeoutMs: 5000 })).exitCode === 0;
  } catch {
    // run() rejects when gh is not on PATH.
    return false;
  }
}

/**
 * Watches the current branch's pull request, and every other PR this session
 * opens or names with `/pr track`, with `gh`, and shows their CI and review
 * state at the end of the prompt footer. What `decide` promotes is sent to the
 * model, along with a block already present when a PR is first seen. Every
 * other change is only shown and logged.
 */
export function register(on: On, options: PluginOptions): void {
  const { noise, error: noiseError } = noiseOf(
    String(options.reviewers ?? ""),
    String(options.ignore ?? ""),
    String(options.ignoreBody ?? ""),
  );
  const watch: Watch = {
    branch: trackedOf("branch", true),
    others: new Map(),
    ended: [],
    me: new Map(),
    noise,
    ticker: undefined,
    tickedAt: undefined,
    turns: new Map(),
    footer: undefined,
    isMutedOpen: false,
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
    if (!(await hasGh($))) {
      emit($, "session.start", { active: false, reason: "gh unavailable" });
      return started;
    }
    // A session.end while this start was in flight has moved the generation on.
    if (watch.generation !== generation) return started;
    emit($, "session.start", { active: true });
    // The watch runs without the command, so a refusal only logs.
    $.command
      .register({
        name: "pr",
        description: "Show what the PR watcher sees, or track or untrack a PR",
        argumentHint: "[track <url> | untrack <url|#n>]",
      })
      .catch((error: unknown) => {
        emit($, "command.register", { error: String(error) }, false);
      });
    if (noiseError !== undefined) emit($, "ignoreBody.invalid", { error: noiseError }, false);
    if (watch.isStopped) {
      watch.isStopped = false;
      watch.me.clear();
      watch.generation += 1;
      watch.tickedAt = undefined;
      await restore($, watch);
      for (const t of entriesOf(watch)) {
        Object.assign(t, { due: 0, pollingSince: undefined, streak: 0 });
      }
      start($, watch);
    } else {
      void wake($, watch);
    }
    return started;
  });

  on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
    const footer = watch.footer;
    if (footer === undefined) return next(e);
    if (e.viewport === undefined) {
      const tail = e.props.tail === undefined ? footer.tail : `${e.props.tail} · ${footer.tail}`;
      return next({ ...e, props: { ...e.props, tail } });
    }
    return drawFooter($, e, footer.chips, await next(e));
  });

  on("session.end", ($, e, next) => {
    if (!CONTINUING.has(e.reason)) {
      watch.isStopped = true;
      watch.generation += 1;
      watch.ticker?.cancel();
      watch.footer = undefined;
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("command.run", { command: "pr" }, async ($, e) => {
    const command = parsePrCommand(e.args);
    if (command.kind === "invalid") return { text: `/pr: ${command.reason}` };
    if (command.kind === "track") return { text: track($, watch, command.ref, "manual") };
    if (command.kind === "untrack") {
      if ("ref" in command) {
        const { ref } = command;
        return {
          text: untrack($, watch, (t) => t.key === ref.key, `${ref.owner}/${ref.repo}#${ref.pr}`),
        };
      }
      const { pr } = command;
      return { text: untrack($, watch, (t) => t.snapshot?.pr === pr, `#${pr}`) };
    }
    // A second /pr closes it: the close mark and its chord do not reach every terminal.
    if ((await $.ui.panes()).some((pane) => pane.id === PANE)) {
      await $.ui.close({ id: PANE });
      emit($, "pane.close", {});
      return {};
    }
    const opened = await $.ui.open({ id: PANE, title: "PR", closeOnEscape: true });
    emit($, "pane.open", { placed: opened.isPlaced, pr: watch.branch.snapshot?.pr });
    return opened.isPlaced ? {} : { text: `/pr: the pane is not drawn (${opened.reason})` };
  }).catch(($, e, next) => {
    emit($, "pane.open", { error: next.error.message }, false);
    return { text: `/pr failed: ${next.error.message ?? next.error.kind}` };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) =>
    drawPane($, e, seenOf(watch), await $.clock.now()),
  );

  on("ui.press", { plugin: "github" }, ($, e, next) => {
    if (e.element === REFRESH) {
      void refresh($, watch);
      return { element: e.element };
    }
    if (e.element !== MUTED) return next(e);
    watch.isMutedOpen = !watch.isMutedOpen;
    const count = seenOf(watch).prs[0]?.snapshot.muted.length;
    emit($, "pane.muted", { open: watch.isMutedOpen, count });
    $.ui.invalidate("ui.render");
    return { element: e.element };
  });

  // Not tool.call: a Bash hook there turns off moving a command to the background.
  on("classic.PostToolUse", ($, e, next) => {
    const bash = bashOf(e);
    if (bash !== undefined && !watch.isStopped) {
      const found = prUrlsOf(bash.command, bash.output);
      for (const { ref, origin } of found) track($, watch, ref, origin);
      if (found.length > 0) {
        emit($, "discover", { origin: found[0]?.origin, count: found.length });
        persist($, watch);
      }
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on("turn.start", async ($, e, next) => {
    // Every span is kept: a full read rescans every post, old ones included.
    watch.turns.set(e.turnId, [await $.clock.now(), undefined]);
    render($, watch);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const span = watch.turns.get(e.turnId);
    if (span !== undefined) span[1] = await $.clock.now();
    render($, watch);
    if (e.agentId === undefined) {
      // No probed resource moves when a thread is resolved, which a turn often does.
      for (const t of entriesOf(watch)) t.isFullDue = true;
      void wake($, watch);
    }
    return next(e);
  }).catch(($, e, next) => next(e));
}
