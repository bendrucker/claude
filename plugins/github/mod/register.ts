import type { EngineInterface, On } from "claude-code";
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

async function readPr($: EngineInterface): Promise<Read> {
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
  return { kind: "pr", snapshot: snapshotOf(parsed) };
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

// What a dropped injection still has to say: failures only on the same head
// and only for checks still failing, reviews only while the PR is open.
function stillDue(undelivered: Undelivered | undefined, next: Snapshot): Promoted[] {
  if (undelivered === undefined || next.state !== "OPEN") return [];
  return undelivered.decisions.flatMap((decision): Promoted[] => {
    if (decision.kind !== "ci.failed") return [decision];
    if (undelivered.head !== next.head) return [];
    const failed = decision.failed.filter((label) => next.failed.includes(label));
    return failed.length > 0 ? [{ ...decision, failed }] : [];
  });
}

function merge(carried: Promoted[], fresh: Promoted[]): Promoted[] {
  const failed = [...carried, ...fresh].flatMap((d) => (d.kind === "ci.failed" ? d.failed : []));
  const reviews = [...carried, ...fresh].filter((d) => d.kind !== "ci.failed");
  if (failed.length === 0) return reviews;
  return [
    { action: "promote", kind: "ci.failed", failed: [...new Set(failed)].toSorted() },
    ...reviews,
  ];
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
  const next = read.snapshot;
  const prev = watch.snapshot;
  if (prev === undefined || prev.pr !== next.pr) {
    emit($, "pr.tracked", { pr: next.pr, head: next.head, phase: next.phase, state: next.state });
    watch.undelivered = undefined;
  } else {
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { pr: next.pr, head: next.head, ...detail });
    }
    const fresh = decisions.filter((d): d is Promoted => d.action === "promote");
    const due = merge(stillDue(watch.undelivered, next), fresh);
    const attempt = fresh.length > 0 ? 1 : (watch.undelivered?.attempts ?? 0) + 1;
    watch.undelivered = undefined;
    if (due.length > 0) {
      const isSent = await inject($, next, due, attempt);
      if (!isCurrent()) return undefined;
      if (!isSent && attempt < MAX_ATTEMPTS) {
        watch.undelivered = { head: next.head, decisions: due, attempts: attempt };
      }
    }
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
    const read = await readPr($);
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
      show($, watch, line === "" ? "⚠️ stale" : `${line} · ⚠️ stale`);
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
 * review state at the end of the prompt footer. A newly failed check or a review requesting
 * changes is sent to the model; every other change is only shown and logged.
 */
export function register(on: On): void {
  const watch: Watch = {
    snapshot: undefined,
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
