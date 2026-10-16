import type { EngineInterface, On } from "claude-code";
import {
  STALE,
  type Promoted,
  type Snapshot,
  VIEW_FIELDS,
  baselineOf,
  combine,
  decide,
  messageOf,
  parseView,
  snapshotOf,
  statusOf,
} from "./pr.ts";

const MOD = "github";

export const POLL_MS = {
  pending: 60_000,
  settled: 180_000,
  idle: 120_000,
  closed: 600_000,
  error: 300_000,
} as const;

// A dropped injection is retried on later polls, up to this many attempts.
export const MAX_ATTEMPTS = 3;
// Skipped when origin/HEAD is unset and the real default branch is unknown.
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
  me: string | undefined;
  undelivered: Undelivered | undefined;
  error: string | undefined;
  timer: { cancel(): void } | undefined;
  line: string | undefined;
  generation: number;
  isStopped: boolean;
}

type Read = { kind: "none" } | { kind: "pr"; snapshot: Snapshot };

function show($: EngineInterface, watch: Watch, text: string | undefined) {
  const line = text === "" ? undefined : text;
  if (line === watch.line) return;
  watch.line = line;
  $.ui.invalidate("ui.render");
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

async function meOf($: EngineInterface, watch: Watch, cwd: string): Promise<string> {
  if (watch.me !== undefined) return watch.me;
  const user = await $.process.run(["gh", "api", "user", "--jq", ".login"], {
    cwd,
    timeoutMs: 20_000,
  });
  const login = user.stdout.trim();
  if (user.exitCode !== 0 || login === "") throw new Error("gh api user returned no login");
  watch.me = login;
  return login;
}

// Every worktree of the repository shares one object store, so only a push from
// another clone or from GitHub itself leaves the head unknown here.
async function isKnown($: EngineInterface, cwd: string, sha: string): Promise<boolean> {
  const result = await $.process.run(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd });
  return result.exitCode === 0;
}

async function readPr($: EngineInterface, watch: Watch): Promise<Read> {
  const cwd = await $.session.cwd();
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = head.stdout.trim();
  if (head.exitCode !== 0 || branch === "HEAD" || (await isDefaultBranch($, cwd, branch))) {
    return { kind: "none" };
  }
  const view = await $.process.run(["gh", "pr", "view", "--json", VIEW_FIELDS], {
    cwd,
    timeoutMs: 20_000,
  });
  if (view.exitCode !== 0) {
    if (/no pull requests found/i.test(view.stderr)) return { kind: "none" };
    const line = view.stderr.trim().split("\n")[0] ?? "";
    throw new Error(line === "" ? `gh exited ${view.exitCode}` : line);
  }
  const parsed = parseView(view.stdout);
  if (parsed === undefined) throw new Error("gh pr view returned an unexpected shape");
  const [me, isHeadKnown] = await Promise.all([
    meOf($, watch, cwd),
    isKnown($, cwd, parsed.headRefOid),
  ]);
  return { kind: "pr", snapshot: snapshotOf(parsed, { me, isHeadKnown }) };
}

async function inject(
  $: EngineInterface,
  snapshot: Snapshot,
  promoted: Promoted[],
  attempt: number,
): Promise<boolean> {
  const text = messageOf(snapshot, promoted);
  const kinds = promoted.map((d) => d.kind);
  const detail = { pr: snapshot.pr, head: snapshot.head, kinds, chars: text.length, attempt };
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

// What a dropped injection still has to say: the PR's end always, a block
// while it lasts, a foreign push until the checkout has it, failures only on
// the same head for checks still failing, and feedback while the PR is open.
function stillDue(undelivered: Undelivered | undefined, next: Snapshot): Promoted[] {
  if (undelivered === undefined) return [];
  return undelivered.decisions.flatMap((decision): Promoted[] => {
    if (decision.kind === "pr.merged" || decision.kind === "pr.closed") return [decision];
    if (next.state !== "OPEN") return [];
    if (decision.kind === "conflict" || decision.kind === "behind") {
      return next.block === undefined || next.block === decision.kind ? [decision] : [];
    }
    if (decision.kind === "push.foreign") return next.isHeadKnown ? [] : [decision];
    if (decision.kind !== "ci.failed") return [decision];
    if (undelivered.head !== next.head) return [];
    const failed = decision.failed.filter((label) => next.failed.includes(label));
    return failed.length > 0 ? [{ ...decision, failed }] : [];
  });
}

// Resolves false when the watch stopped or restarted during the send.
async function send(
  $: EngineInterface,
  watch: Watch,
  next: Snapshot,
  due: Promoted[],
  attempt: number,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (due.length === 0) return true;
  const isSent = await inject($, next, due, attempt);
  if (!isCurrent()) return false;
  if (!isSent && attempt < MAX_ATTEMPTS) {
    watch.undelivered = { head: next.head, decisions: due, attempts: attempt };
  }
  return true;
}

function delayOf(snapshot: Snapshot): number {
  if (snapshot.state !== "OPEN") return POLL_MS.closed;
  return snapshot.phase === "pending" ? POLL_MS.pending : POLL_MS.settled;
}

// Resolves undefined when the watch stopped or restarted during the send.
async function apply(
  $: EngineInterface,
  watch: Watch,
  read: Read,
  isCurrent: () => boolean,
): Promise<number | undefined> {
  if (read.kind === "none") {
    show($, watch, undefined);
    watch.snapshot = undefined;
    watch.undelivered = undefined;
    return POLL_MS.idle;
  }
  const prev = watch.snapshot;
  const isSamePr = prev !== undefined && prev.pr === read.snapshot.pr;
  // An undecided poll keeps the last answer, so a recompute does not re-announce a block.
  const next =
    isSamePr && read.snapshot.block === undefined
      ? { ...read.snapshot, block: prev.block }
      : read.snapshot;
  if (!isSamePr) {
    emit($, "pr.tracked", { pr: next.pr, head: next.head, phase: next.phase, state: next.state });
    watch.undelivered = undefined;
    const baseline = baselineOf(next);
    for (const { action, ...detail } of baseline) {
      emit($, action, { pr: next.pr, head: next.head, baseline: true, ...detail });
    }
    if (!(await send($, watch, next, baseline, 1, isCurrent))) return undefined;
  } else {
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { pr: next.pr, head: next.head, ...detail });
    }
    const fresh = decisions.filter((d): d is Promoted => d.action === "promote");
    const due = combine(stillDue(watch.undelivered, next), fresh);
    const attempt = fresh.length > 0 ? 1 : (watch.undelivered?.attempts ?? 0) + 1;
    watch.undelivered = undefined;
    if (!(await send($, watch, next, due, attempt, isCurrent))) return undefined;
  }
  watch.snapshot = next;
  show($, watch, statusOf(next));
  return delayOf(next);
}

async function poll($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  if (!isCurrent()) return;
  let delay: number;
  try {
    const read = await readPr($, watch);
    // A session.end that landed while gh ran has already cleared the status.
    if (!isCurrent()) return;
    const applied = await apply($, watch, read, isCurrent);
    if (applied === undefined) return;
    delay = applied;
    watch.error = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== watch.error) emit($, "poll.error", { error: message }, false);
    watch.error = message;
    delay = POLL_MS.error;
    if (watch.snapshot !== undefined && isCurrent()) {
      const line = statusOf(watch.snapshot);
      show($, watch, line === "" ? STALE : `${line} · ${STALE}`);
    }
  }
  if (!isCurrent()) return;
  watch.timer = $.clock.after(delay, () => void poll($, watch, generation));
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
export function register(on: On): void {
  const watch: Watch = {
    snapshot: undefined,
    me: undefined,
    undelivered: undefined,
    error: undefined,
    timer: undefined,
    line: undefined,
    generation: 0,
    isStopped: true,
  };

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    if (!e.isInteractive) {
      emit($, "session.start", { active: false, reason: "non-interactive" });
      return started;
    }
    if (!(await hasGh($))) {
      emit($, "session.start", { active: false, reason: "gh unavailable" });
      return started;
    }
    emit($, "session.start", { active: true });
    if (watch.isStopped) {
      watch.isStopped = false;
      watch.generation += 1;
      void poll($, watch, watch.generation);
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
      watch.timer?.cancel();
      show($, watch, undefined);
    }
    return next(e);
  });
}
