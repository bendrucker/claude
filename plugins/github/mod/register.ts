import type { EngineInterface, On, PluginOptions, Timer } from "claude-code";
import { drawPane, MUTED, PANE } from "./pane.tsx";
import {
  type Noise,
  type Promoted,
  type Snapshot,
  type Span,
  EXTRAS_QUERY,
  type Extras,
  VIEW_FIELDS,
  baselineOf,
  combine,
  decide,
  messageOf,
  parseExtras,
  noiseOf,
  parseView,
  snapshotOf,
  statusOf,
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
export const BACKOFF_CAP_MS = QUIET_MS.at(-1) ?? 0;
// A PR opened elsewhere shows up within this long, even on an idle session.
export const IDLE_CAP_MS = 10 * 60_000;
// A gap this long between ticks means the host slept or the ticker died.
const LATE_MS = 3 * TICK_MS;
// A poll in flight this long lost a dispatch, so the next tick polls anyway.
const STUCK_MS = 5 * 60_000;
// Probes miss a resolved thread and a merge queue's progress, so a full read runs this often.
const FULL_EVERY_MS = 30 * 60_000;

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

interface Watch {
  snapshot: Snapshot | undefined;
  /** The last full read, before any carry-forward, which an unchanged probe repeats. */
  last: { cwd: string; branch: string; snapshot: Snapshot } | undefined;
  /** The last ETag per REST path the gate probes. */
  etags: Map<string, string>;
  /** When the last full read ran, which the gate forces again after a while. */
  fullAt: number;
  extras: { url: string; extras: Extras } | undefined;
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
  /** Why the last poll found no PR, and on which branch. */
  none: string | undefined;
  /** This session's turns by id, any agent's, to tell its posts from the person's. */
  turns: Map<string, Span>;
  line: string | undefined;
  /** How the last successful poll read the PR. */
  via: Via | undefined;
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
      cache: Pick<Watch, "last" | "etags">;
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

// The login only filters the viewer's own feedback, so a token that cannot read
// it leaves that feedback unfiltered rather than failing the poll.
async function meOf(
  $: EngineInterface,
  watch: Watch,
  cwd: string,
  url: string,
): Promise<string | undefined> {
  if (watch.me !== undefined) return watch.me;
  const argv = ["gh", "api", "user", "--hostname", new URL(url).hostname, "--jq", ".login"];
  const user = await $.process.run(argv, { cwd, timeoutMs: 20_000 });
  const login = user.stdout.trim();
  if (user.exitCode !== 0 || login === "") return undefined;
  watch.me = login;
  return login;
}

// Only the footer and the pane read the extras, so a failed read keeps the
// last answer for the same PR rather than failing the poll.
async function extrasOf(
  $: EngineInterface,
  watch: Watch,
  cwd: string,
  url: string,
): Promise<Extras | undefined> {
  try {
    const extras = await readExtras($, cwd, url);
    watch.extras = { url, extras };
    return extras;
  } catch (error) {
    emit(
      $,
      "extras.read",
      { error: error instanceof Error ? error.message : String(error) },
      false,
    );
    return watch.extras?.url === url ? watch.extras.extras : undefined;
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
  watch: Watch,
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
    paths.map((entry) => probe($, cwd, hostname, entry, watch.etags.get(entry[1]))),
  );
  const etags = new Map(probes.flatMap((p) => (p.etag === undefined ? [] : [[p.path, p.etag]])));
  return { changed: probes.filter((p) => !p.isSame).map((p) => p.name), etags };
}

async function readPr($: EngineInterface, watch: Watch, now: number): Promise<Read> {
  const cwd = await $.session.cwd();
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = head.stdout.trim();
  if (head.exitCode !== 0) return { kind: "none", reason: "no git", branch };
  if (branch === "HEAD") return { kind: "none", reason: "detached", branch };
  if (await isDefaultBranch($, cwd, branch)) {
    return { kind: "none", reason: "default branch", branch };
  }
  // A merged or closed PR keeps answering 304, so a new PR on its branch needs the
  // full read, as does a mergeability GitHub has yet to decide.
  const last = watch.last;
  const isProbed =
    watch.snapshot !== undefined &&
    now - watch.fullAt < FULL_EVERY_MS &&
    last?.cwd === cwd &&
    last.branch === branch &&
    last.snapshot.state === "OPEN" &&
    last.snapshot.block !== undefined;
  const probed = isProbed ? await changedOf($, watch, cwd, last.snapshot) : undefined;
  const changed = probed?.changed;
  if (isProbed && probed?.changed.length === 0) {
    const cache = { last, etags: probed.etags };
    return { kind: "pr", snapshot: last.snapshot, read: "hit", changed, cache };
  }
  const view = await $.process.run(["gh", "pr", "view", "--json", VIEW_FIELDS], {
    cwd,
    timeoutMs: 20_000,
  });
  if (view.exitCode !== 0) {
    if (/no pull requests found/i.test(view.stderr)) {
      return { kind: "none", reason: "no pr", branch };
    }
    if (FOREIGN.test(view.stderr)) return { kind: "none", reason: "not github", branch };
    const line = view.stderr.trim().split("\n")[0] ?? "";
    throw new Error(line === "" ? `gh exited ${view.exitCode}` : line);
  }
  const parsed = parseView(view.stdout);
  if (parsed === undefined) throw new Error("gh pr view returned an unexpected shape");
  const [me, isHeadKnown, extras] = await Promise.all([
    meOf($, watch, cwd, parsed.url),
    isHeadKnownOf($, watch, cwd, parsed.headRefOid),
    extrasOf($, watch, cwd, parsed.url),
  ]);
  const turns = [...watch.turns.values()];
  const snapshot = snapshotOf(parsed, { me, isHeadKnown, noise: watch.noise, turns, extras });
  const cache = { last: { cwd, branch, snapshot }, etags: probed?.etags ?? watch.etags };
  const read = changed === undefined ? "full" : "miss";
  return { kind: "pr", snapshot, read, changed, cache };
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

function schedule($: EngineInterface, watch: Watch, streak: number, cause: string): void {
  const was = delayOf(watch.snapshot, watch.streak);
  const delay = delayOf(watch.snapshot, streak);
  if (delay !== was) {
    const detail = { pr: watch.snapshot?.pr, streak, delayMs: delay };
    if (streak > 0) emit($, "poll.backoff", detail);
    else emit($, "poll.reset", { ...detail, cause, fromMs: was });
  }
  const url = watch.snapshot?.url;
  if (url !== undefined && streak !== watch.streak) {
    void $.state.set({ plugin: "github", key: "quiet", id: url }, streak);
  }
  watch.streak = streak;
  watch.due = watch.polledAt + delay;
}

// Logs each newly muted item, marking those already there when the PR is first seen.
function mute($: EngineInterface, watch: Watch, prev: Snapshot | undefined, next: Snapshot) {
  const seen = new Set(prev?.muted.map((m) => m.id));
  const fresh = next.muted.filter((m) => !seen.has(m.id));
  const baseline = prev === undefined ? { baseline: true } : {};
  for (const m of fresh) emit($, "muted", { pr: next.pr, head: next.head, ...baseline, ...m });
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
    if (isChanged) emit($, "pr.none", { reason: read.reason, branch: read.branch, from: prev?.pr });
    show($, watch, undefined);
    watch.none = none;
    watch.snapshot = undefined;
    watch.held = [];
    watch.undelivered = undefined;
    return { isTracked: false, isChanged };
  }
  watch.none = undefined;
  const prev = watch.snapshot;
  const isSamePr = prev !== undefined && prev.pr === read.snapshot.pr;
  // An undecided poll keeps the last answer, so a recompute does not re-announce a block.
  const decided = read.snapshot.block;
  const next =
    isSamePr && decided === undefined ? { ...read.snapshot, block: prev.block } : read.snapshot;
  let due: Promoted[];
  let attempt = 1;
  let isChanged = true;
  if (!isSamePr) {
    emit($, "pr.tracked", { pr: next.pr, head: next.head, phase: next.phase, state: next.state });
    watch.undelivered = undefined;
    watch.held = [];
    mute($, watch, undefined, next);
    due = baselineOf(next);
    for (const { action, ...detail } of due) {
      emit($, action, { pr: next.pr, head: next.head, baseline: true, ...detail });
    }
  } else {
    mute($, watch, prev, next);
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { pr: next.pr, head: next.head, ...detail });
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
  if (!isSamePr || JSON.stringify(turn) !== JSON.stringify(turnOf(prev))) {
    emit($, "review.turn", { pr: next.pr, head: next.head, ...turn });
  }
  watch.snapshot = next;
  render($, watch);
  // The send waits for an idle session, so the next poll is not held on it.
  if (due.length > 0) {
    void send($, watch, next, due, watch.held, attempt, isCurrent);
    watch.held = [];
  }
  return { isTracked: !isSamePr, isChanged };
}

async function poll($: EngineInterface, watch: Watch, generation: number, now: number) {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  const seq = ++watch.polls;
  try {
    const read = await readPr($, watch, now);
    if (read.kind === "pr") {
      const ms = (await $.clock.now()) - now;
      const detail = { pr: read.snapshot.pr, read: read.read, changed: read.changed };
      void $.modEvents.emit({ mod: MOD, event: "poll", ms, detail });
    }
    // A session.end that landed while gh ran has already cleared the status.
    if (!isCurrent() || seq !== watch.polls) return;
    watch.error = undefined;
    watch.errors = 0;
    watch.via = read.kind === "pr" ? read.read : undefined;
    if (read.kind === "pr") {
      Object.assign(watch, read.cache);
      if (read.read !== "hit") watch.fullAt = now;
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
    emit($, "watch.revived", { silentMs, pr: watch.snapshot?.pr });
    start($, watch);
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
 * Watches the current branch's pull request with `gh` and shows its CI and
 * review state at the end of the prompt footer. What `decide` promotes is sent
 * to the model, along with a block already present when a PR is first seen.
 * Every other change is only shown and logged.
 */
export function register(on: On, options: PluginOptions): void {
  const { noise, error: noiseError } = noiseOf(
    String(options.reviewers ?? ""),
    String(options.ignore ?? ""),
    String(options.ignoreBody ?? ""),
  );
  const watch: Watch = {
    snapshot: undefined,
    last: undefined,
    etags: new Map(),
    fullAt: 0,
    extras: undefined,
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
    if (!(await hasGh($))) {
      emit($, "session.start", { active: false, reason: "gh unavailable" });
      return started;
    }
    // A session.end while this start was in flight has moved the generation on.
    if (watch.generation !== generation) return started;
    emit($, "session.start", { active: true });
    // The watch runs without the command, so a refusal only logs.
    $.command
      .register({ name: "pr", description: "Show what the PR watcher sees" })
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

  on("command.run", { command: "pr" }, async ($) => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: "PR" });
    emit($, "pane.open", { placed: isPlaced, pr: watch.snapshot?.pr });
    return {};
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) =>
    drawPane($, e, watch, await $.clock.now()),
  );

  on("ui.press", { plugin: "github" }, ($, e, next) => {
    if (e.element !== MUTED) return next(e);
    watch.isMutedOpen = !watch.isMutedOpen;
    emit($, "pane.muted", { open: watch.isMutedOpen, count: watch.snapshot?.muted.length });
    $.ui.invalidate("ui.render");
    return { element: e.element };
  });

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
      watch.etags.clear();
      void wake($, watch);
    }
    return next(e);
  }).catch(($, e, next) => next(e));
}
