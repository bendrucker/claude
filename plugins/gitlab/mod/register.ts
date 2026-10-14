import type { EngineInterface, On } from "claude-code";
import {
  STALE,
  type Job,
  type Promoted,
  type Snapshot,
  decide,
  isOpen,
  messageOf,
  parseApprovals,
  parseJobs,
  parseNotes,
  parseUser,
  parseView,
  snapshotOf,
  statusOf,
} from "./mr.ts";

const MOD = "gitlab";

export const POLL_MS = {
  pending: 60_000,
  settled: 180_000,
  idle: 120_000,
  closed: 600_000,
  error: 300_000,
} as const;

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

interface Watch {
  snapshot: Snapshot | undefined;
  branch: string | undefined;
  me: string | undefined;
  undelivered: Undelivered | undefined;
  error: string | undefined;
  timer: { cancel(): void } | undefined;
  line: string | undefined;
  generation: number;
  isStopped: boolean;
}

type Read = { kind: "none" } | { kind: "mr"; snapshot: Snapshot; branch: string };

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

const NO_MR = /no (open )?merge request/i;

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

async function meOf($: EngineInterface, watch: Watch, cwd: string): Promise<string> {
  if (watch.me !== undefined) return watch.me;
  watch.me = parsed(parseUser(await glab($, cwd, ["api", "user"])), "glab api user");
  return watch.me;
}

async function readMr($: EngineInterface, watch: Watch, isRetry = false): Promise<Read> {
  const cwd = await $.session.cwd();
  const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = head.stdout.trim();
  if (head.exitCode !== 0 || branch === "HEAD" || (await isDefaultBranch($, cwd, branch))) {
    return { kind: "none" };
  }
  const stdout = await viewMr($, watch, cwd, branch);
  if (stdout === undefined) return { kind: "none" };
  const view = parsed(parseView(stdout), "glab mr view");
  const prev = watch.snapshot;
  // A merged or closed MR changes nothing else the watch shows.
  if (prev?.mr === view.iid && !isOpen(prev) && view.state === prev.state) {
    return { kind: "mr", snapshot: prev, branch };
  }
  const mr = `projects/${view.projectId}/merge_requests/${view.iid}`;
  const pipeline = view.pipeline;
  const [approvals, notes, jobs, me] = await Promise.all([
    glab($, cwd, ["api", `${mr}/approvals`]),
    glab($, cwd, ["api", `${mr}/notes?sort=desc&order_by=created_at&per_page=100`]),
    pipeline === null
      ? Promise.resolve<Job[]>([])
      : jobsOf($, cwd, pipeline.projectId, pipeline.id),
    meOf($, watch, cwd),
  ]);
  const read = snapshotOf({
    view,
    approvals: parsed(parseApprovals(approvals), "MR approvals"),
    notes: parsed(parseNotes(notes), "MR notes"),
    jobs,
    me,
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
    if (recheck.sha !== view.sha) return readMr($, watch, true);
  }
  return { kind: "mr", snapshot, branch };
}

async function inject(
  $: EngineInterface,
  snapshot: Snapshot,
  promoted: Promoted[],
  attempt: number,
): Promise<boolean> {
  const text = messageOf(snapshot, promoted);
  const kinds = promoted.map((d) => d.kind);
  const detail = { mr: snapshot.mr, head: snapshot.head, kinds, chars: text.length, attempt };
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

function stillDue(undelivered: Undelivered | undefined, next: Snapshot): Promoted[] {
  if (undelivered === undefined || !isOpen(next)) return [];
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
  if (!isOpen(snapshot)) return POLL_MS.closed;
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
    watch.branch = undefined;
    watch.undelivered = undefined;
    return POLL_MS.idle;
  }
  const next = read.snapshot;
  const prev = watch.snapshot;
  if (prev === undefined || prev.mr !== next.mr || prev.projectId !== next.projectId) {
    emit($, "mr.tracked", { mr: next.mr, head: next.head, phase: next.phase, state: next.state });
    watch.undelivered = undefined;
  } else {
    const decisions = decide(prev, next);
    for (const { action, ...detail } of decisions) {
      emit($, action, { mr: next.mr, head: next.head, ...detail });
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
  watch.branch = read.branch;
  show($, watch, statusOf(next));
  return delayOf(next);
}

async function poll($: EngineInterface, watch: Watch, generation: number): Promise<void> {
  const isCurrent = () => !watch.isStopped && watch.generation === generation;
  if (!isCurrent()) return;
  let delay: number;
  try {
    const read = await readMr($, watch);
    // A session.end that landed while glab ran has already cleared the status.
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
 * and approval state at the end of the prompt footer. A newly failed job or any
 * new approval, unapproval, or comment from someone else is sent to the model.
 * Every other change is only shown and logged.
 */
export function register(on: On): void {
  const watch: Watch = {
    snapshot: undefined,
    branch: undefined,
    me: undefined,
    undelivered: undefined,
    error: undefined,
    timer: undefined,
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
    if (!(await hasGlab($))) {
      emit($, "session.start", { active: false, reason: "glab unavailable" });
      return started;
    }
    // A session.end while this start was in flight has moved the generation on.
    if (watch.generation !== generation) return started;
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
      watch.generation += 1;
      watch.timer?.cancel();
      show($, watch, undefined);
    }
    return next(e);
  });
}
