import type { EngineInterface, On, Timer } from "claude-code";
import {
  type Promoted,
  type Snapshot,
  VIEW_FIELDS,
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

const UNTRACKED_BRANCHES = new Set(["HEAD", "main", "master"]);
// /clear and /resume keep the process running, so the watch continues.
const CONTINUING = new Set(["clear", "resume"]);

interface Watch {
  snapshot: Snapshot | undefined;
  flagged: boolean;
  error: string | undefined;
  timer: Timer | undefined;
  generation: number;
  isStopped: boolean;
}

type Read = { kind: "none" } | { kind: "pr"; snapshot: Snapshot };

function emit($: EngineInterface, event: string, detail: Record<string, unknown>, ok = true) {
  void $.modEvents.emit({ mod: MOD, event, ok, detail });
}

async function readPr($: EngineInterface): Promise<Read> {
  const cwd = await $.session.cwd();
  const branch = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (branch.exitCode !== 0 || UNTRACKED_BRANCHES.has(branch.stdout.trim())) {
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
  return { kind: "pr", snapshot: snapshotOf(parsed) };
}

async function inject(
  $: EngineInterface,
  snapshot: Snapshot,
  promoted: Promoted[],
): Promise<boolean> {
  const text = messageOf(snapshot, promoted);
  const kinds = promoted.map((d) => d.kind);
  const detail = { pr: snapshot.pr, head: snapshot.head, kinds, chars: text.length };
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

function delayOf(snapshot: Snapshot): number {
  if (snapshot.state !== "OPEN") return POLL_MS.closed;
  return snapshot.phase === "pending" ? POLL_MS.pending : POLL_MS.settled;
}

async function apply($: EngineInterface, watch: Watch, read: Read): Promise<number> {
  if (read.kind === "none") {
    if (watch.snapshot !== undefined) $.ui.status(undefined);
    watch.snapshot = undefined;
    watch.flagged = false;
    return POLL_MS.idle;
  }
  const next = read.snapshot;
  const prev = watch.snapshot;
  if (prev === undefined || prev.pr !== next.pr) {
    emit($, "pr.tracked", { pr: next.pr, head: next.head, phase: next.phase, state: next.state });
    watch.flagged = false;
  } else {
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { pr: next.pr, head: next.head, ...detail });
    }
    const promoted = decisions.filter((d): d is Promoted => d.action === "promote");
    if (promoted.length > 0) watch.flagged = await inject($, next, promoted);
    else if (decisions.length > 0) watch.flagged = false;
  }
  watch.snapshot = next;
  $.ui.status(statusOf(next, watch.flagged));
  return delayOf(next);
}

async function poll($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  if (!isCurrent()) return;
  let delay: number;
  try {
    const read = await readPr($);
    // A session.end that landed while gh ran has already cleared the status.
    if (!isCurrent()) return;
    delay = await apply($, watch, read);
    watch.error = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== watch.error) emit($, "poll.error", { error: message }, false);
    watch.error = message;
    delay = POLL_MS.error;
    if (watch.snapshot !== undefined && isCurrent()) {
      $.ui.status(`${statusOf(watch.snapshot, watch.flagged)} · stale`);
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
 * review state as a status line. A newly failed check or a review requesting
 * changes is sent to the model; every other change is only shown and logged.
 */
export function register(on: On): void {
  const watch: Watch = {
    snapshot: undefined,
    flagged: false,
    error: undefined,
    timer: undefined,
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

  on("session.end", ($, e, next) => {
    if (!CONTINUING.has(e.reason)) {
      watch.isStopped = true;
      watch.timer?.cancel();
      $.ui.status(undefined);
    }
    return next(e);
  });
}
