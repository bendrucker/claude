#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";
import { cli } from "cleye";
import UrlPattern from "url-pattern";
import { z } from "zod";

const DEFAULT_INTERVAL_SECONDS = 180;
const NO_HISTORY_INTERVAL_SECONDS = 30;

// GitHub computes mergeability asynchronously: right after the base branch
// advances, `mergeable`/`mergeStateStatus` read UNKNOWN until a background job
// settles. Re-querying drives that computation, so the watcher re-polls a
// bounded number of times before deciding the platform is undecided.
const MERGEABLE_UNKNOWN_RETRIES = 4;
const MERGEABLE_RECHECK_SECONDS = 5;

export type StatusState = "running" | "failing" | "success";
export type InternalState = StatusState | "queued";

export type MergeStateStatus =
  | "BEHIND"
  | "BLOCKED"
  | "CLEAN"
  | "DIRTY"
  | "DRAFT"
  | "HAS_HOOKS"
  | "UNKNOWN"
  | "UNSTABLE";

export type Probe = {
  sha: string;
  state: InternalState;
  runId: string | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: MergeStateStatus;
  prState: "OPEN" | "CLOSED" | "MERGED";
};

// url-pattern's match() returns `any`.
const PrUrlParams = z.object({ owner: z.string(), repo: z.string(), number: z.string() });
const RepoParams = z.object({ owner: z.string(), repo: z.string() });

// gh reports a status outside the documented set as UNKNOWN, which the caller
// already treats as undetermined.
const MergeableField = z
  .enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"])
  .catch("UNKNOWN") satisfies z.ZodType<Probe["mergeable"]>;
const MergeStateStatusField = z
  .enum(["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"])
  .catch("UNKNOWN") satisfies z.ZodType<MergeStateStatus>;

const PrView = z.looseObject({
  headRefOid: z.string().catch(""),
  headRefName: z.string().catch(""),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]).catch("OPEN"),
  mergeable: MergeableField,
  mergeStateStatus: MergeStateStatusField,
});

const MergeabilityView = z.looseObject({
  mergeable: MergeableField,
  mergeStateStatus: MergeStateStatusField,
});

const Check = z.looseObject({
  state: z.string().optional().catch(undefined),
  bucket: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
});
export type Check = z.infer<typeof Check>;
const Checks = z.array(Check);

const RunView = z.looseObject({
  headSha: z.string().catch(""),
  databaseId: z.union([z.number(), z.string()]).optional().catch(undefined),
  status: z.string().catch(""),
  conclusion: z.string().catch(""),
});
type RunView = z.infer<typeof RunView>;

const RunList = z.array(RunView);
const Durations = z.array(z.unknown());

export type Event =
  | { type: "status"; state: StatusState; sha: string; run_id: string | null }
  | { type: "conflicts"; sha: string }
  | { type: "mergeable-unknown"; sha: string }
  | { type: "queued-timeout"; minutes: number }
  | { type: "api-error"; consecutive: number }
  | { type: "rate-limited"; retry_after: string }
  | { type: "pr-closed" }
  | { type: "merged" }
  | { type: "max-time-reached"; minutes: number };

// A conflict is definite when either signal says so; mergeability is
// undetermined while either signal is UNKNOWN. The two probes are
// belt-and-suspenders: `mergeable` and `mergeStateStatus` can lag each other.
export function probeIsConflict(probe: Probe): boolean {
  return probe.mergeable === "CONFLICTING" || probe.mergeStateStatus === "DIRTY";
}

export function probeIsUndetermined(probe: Probe): boolean {
  return probe.mergeable === "UNKNOWN" || probe.mergeStateStatus === "UNKNOWN";
}

export type WatcherState = {
  lastSha: string | null;
  lastState: StatusState | null;
  queuedSince: number | null;
  queuedTimeoutEmitted: boolean;
  apiErrorCount: number;
  apiErrorEmittedAt: number | null;
  emittedConflictsForSha: string | null;
  mergeableUnknownEmittedForSha: string | null;
};

export function initialState(): WatcherState {
  return {
    lastSha: null,
    lastState: null,
    queuedSince: null,
    queuedTimeoutEmitted: false,
    apiErrorCount: 0,
    apiErrorEmittedAt: null,
    emittedConflictsForSha: null,
    mergeableUnknownEmittedForSha: null,
  };
}

function mapToEmitState(state: InternalState): StatusState {
  return state === "queued" ? "running" : state;
}

export function deriveEvents(
  probe: Probe,
  state: WatcherState,
  now: number,
  queuedTimeoutMinutes: number,
): { events: Event[]; state: WatcherState } {
  const events: Event[] = [];
  let next: WatcherState = { ...state };

  if (probe.prState === "CLOSED" || probe.prState === "MERGED") {
    const emitStateTerminal = mapToEmitState(probe.state);
    if (emitStateTerminal === "success" && next.lastState !== "success") {
      events.push({
        type: "status",
        state: "success",
        sha: probe.sha,
        run_id: probe.runId,
      });
      next = { ...next, lastSha: probe.sha, lastState: "success" };
    }
    events.push(probe.prState === "MERGED" ? { type: "merged" } : { type: "pr-closed" });
    return { events, state: next };
  }

  const emitState = mapToEmitState(probe.state);
  const shaChanged = next.lastSha !== probe.sha;
  const stateChanged = next.lastState !== emitState;

  if (shaChanged || stateChanged) {
    events.push({
      type: "status",
      state: emitState,
      sha: probe.sha,
      run_id: probe.runId,
    });
    next = {
      ...next,
      lastSha: probe.sha,
      lastState: emitState,
    };
  }

  if (probeIsConflict(probe)) {
    if (next.emittedConflictsForSha !== probe.sha) {
      events.push({ type: "conflicts", sha: probe.sha });
      next = { ...next, emittedConflictsForSha: probe.sha };
    }
  } else if (probeIsUndetermined(probe) && next.mergeableUnknownEmittedForSha !== probe.sha) {
    events.push({ type: "mergeable-unknown", sha: probe.sha });
    next = { ...next, mergeableUnknownEmittedForSha: probe.sha };
  }

  if (probe.state === "queued") {
    if (next.queuedSince === null) {
      next = { ...next, queuedSince: now, queuedTimeoutEmitted: false };
    } else if (
      !next.queuedTimeoutEmitted &&
      now - next.queuedSince >= queuedTimeoutMinutes * 60 * 1000
    ) {
      events.push({ type: "queued-timeout", minutes: queuedTimeoutMinutes });
      next = { ...next, queuedTimeoutEmitted: true };
    }
  } else {
    if (next.queuedSince !== null || next.queuedTimeoutEmitted) {
      next = { ...next, queuedSince: null, queuedTimeoutEmitted: false };
    }
  }

  return { events, state: next };
}

export function registerApiError(
  state: WatcherState,
  threshold: number,
): { events: Event[]; state: WatcherState } {
  const events: Event[] = [];
  const count = state.apiErrorCount + 1;
  let next: WatcherState = { ...state, apiErrorCount: count };
  if (count >= threshold && next.apiErrorEmittedAt !== count) {
    events.push({ type: "api-error", consecutive: count });
    next = { ...next, apiErrorEmittedAt: count };
  }
  return { events, state: next };
}

export function clearApiErrors(state: WatcherState): WatcherState {
  if (state.apiErrorCount === 0 && state.apiErrorEmittedAt === null) {
    return state;
  }
  return { ...state, apiErrorCount: 0, apiErrorEmittedAt: null };
}

export function parsePrUrl(url: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const pattern = new UrlPattern("https\\://github.com/:owner/:repo/pull/:number(/*)", {
    segmentValueCharset: "a-zA-Z0-9-_.~%",
  });
  const match = PrUrlParams.safeParse(pattern.match(url));
  if (!match.success) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }
  const number = Number.parseInt(match.data.number, 10);
  if (Number.isNaN(number)) {
    throw new Error(`Invalid PR number in URL: ${url}`);
  }
  return { owner: match.data.owner, repo: match.data.repo, number };
}

const stripGit = (s: string): string => (s.endsWith(".git") ? s.slice(0, -4) : s);

export function parseRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (trimmed === "") return null;

  const tryPattern = (pattern: string): { owner: string; repo: string } | null => {
    const match = RepoParams.safeParse(
      new UrlPattern(pattern, { segmentValueCharset: "a-zA-Z0-9-_.~%" }).match(trimmed),
    );
    return match.success ? { owner: match.data.owner, repo: stripGit(match.data.repo) } : null;
  };

  const urlMatch =
    tryPattern("https\\://github.com/:owner/:repo(/*)") ??
    tryPattern("ssh\\://git@github.com/:owner/:repo(/*)");
  if (urlMatch) return urlMatch;

  // scp-like: git@github.com:owner/repo(.git)
  const scpMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  const scpOwner = scpMatch?.at(1);
  const scpRepo = scpMatch?.at(2);
  if (scpOwner != null && scpOwner !== "" && scpRepo != null && scpRepo !== "") {
    return { owner: scpOwner, repo: stripGit(scpRepo) };
  }

  return null;
}

const execOptions: ExecSyncOptions = {
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
};

export type ExecResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string; rateLimited: boolean; retryAfter: string };

export type ExecFn = (command: string) => ExecResult;

export function detectRateLimit(stderr: string): { rateLimited: boolean; retryAfter: string } {
  const lower = stderr.toLowerCase();
  const rateLimited =
    lower.includes("api rate limit") ||
    lower.includes("secondary rate limit") ||
    lower.includes("abuse detection");
  const retryAfterMatch = stderr.match(/x-ratelimit-reset[^\n]*?(\d+)/i);
  const retryAfter = retryAfterMatch?.[1] ?? "";
  return { rateLimited, retryAfter };
}

function streamText(stream: unknown): string {
  if (typeof stream === "string") return stream;
  if (stream instanceof Uint8Array) return new TextDecoder().decode(stream);
  return "";
}

function exec(command: string): ExecResult {
  try {
    const stdout = execSync(command, execOptions).toString().trim();
    return { ok: true, stdout };
  } catch (err) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err ? streamText(err.stderr) : "";
    const { rateLimited, retryAfter } = detectRateLimit(stderr);
    return { ok: false, stderr, rateLimited, retryAfter };
  }
}

function detectRepoFromGit(): { owner: string; repo: string } | null {
  const result = exec("git remote get-url origin");
  if (!result.ok) return null;
  return parseRepo(result.stdout);
}

function emit(event: Event): void {
  console.log(JSON.stringify(event));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Mergeability = {
  mergeable: Probe["mergeable"];
  mergeStateStatus: MergeStateStatus;
};

function parseMergeability(stdout: string): Mergeability | null {
  try {
    return MergeabilityView.parse(JSON.parse(stdout));
  } catch {
    return null;
  }
}

function mergeabilityUndetermined(m: Mergeability): boolean {
  return m.mergeable === "UNKNOWN" || m.mergeStateStatus === "UNKNOWN";
}

// Re-poll mergeability until GitHub settles it or the retry budget runs out.
// The act of querying `gh pr view --json mergeable,mergeStateStatus` nudges
// GitHub's background computation, so repeated reads converge to a definite
// value. Returns the last value seen; still-undetermined after the cap means
// the caller should fall back to a local merge dry-run.
export async function resolveMergeable(
  prNumber: number,
  repo: string,
  run: ExecFn = exec,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<Mergeability> {
  let current: Mergeability = { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" };
  for (let attempt = 0; attempt < MERGEABLE_UNKNOWN_RETRIES; attempt += 1) {
    const result = run(`gh pr view ${prNumber} --repo ${repo} --json mergeable,mergeStateStatus`);
    if (result.ok) {
      const parsed = parseMergeability(result.stdout);
      if (parsed) {
        current = parsed;
        if (!mergeabilityUndetermined(current)) return current;
      }
    }
    if (attempt < MERGEABLE_UNKNOWN_RETRIES - 1) {
      // oxlint-disable-next-line no-await-in-loop -- backoff between mergeability rechecks.
      await sleepFn(MERGEABLE_RECHECK_SECONDS * 1000);
    }
  }
  return current;
}

const isQueuedState = (s: string): boolean =>
  s === "QUEUED" || s === "PENDING" || s === "WAITING" || s === "REQUESTED" || s === "EXPECTED";

// GitHub counts a skipped required check as passing, so a skip is settled and
// says nothing about the PR either way. A cancelled check is a verdict the PR
// never got: it does not fail the target, but it cannot stand in for a check
// that passed, so it holds the PR at running until something re-runs it.
const SKIPPED_BUCKET = "skipping";

// `gh pr checks --json` exposes a unified `state` (status when in-flight,
// conclusion when complete) and a normalized `bucket` ("pass" | "fail" |
// "cancel" | "pending" | "skipping"). It does NOT expose `conclusion`. Use
// `bucket` for terminal classification and `state` to distinguish running
// from queued.
export function deriveChecksState(checks: Check[]): InternalState {
  if (checks.length === 0) {
    return "running";
  }
  const decisive = checks.filter((c) => (c.bucket ?? "").toLowerCase() !== SKIPPED_BUCKET);
  // Skips settle first, so for a few seconds after a push every registered
  // check can be a skip while the real jobs are still being created. That is
  // indistinguishable from a PR whose checks are all genuinely skipped, and
  // calling it success ends a babysit before CI has run. Holding at queued
  // reports the genuinely-skipped PR through the queued timeout instead.
  if (decisive.length === 0) {
    return "queued";
  }
  const buckets = decisive.map((c) => (c.bucket ?? "").toLowerCase());
  if (buckets.some((b) => b === "fail")) {
    return "failing";
  }
  const states = decisive.map((c) => (c.state ?? "").toUpperCase());
  if (states.some((s) => s === "IN_PROGRESS")) return "running";
  const anyQueued = states.some(isQueuedState);
  const allQueued = states.every(isQueuedState);
  if (allQueued && anyQueued) return "queued";
  if (anyQueued) return "running";
  if (buckets.every((b) => b === "pass")) return "success";
  return "running";
}

// Headroom over the runs one commit can trigger, counting re-runs.
const RUN_LOOKUP_LIMIT = 50;

// Conclusions that leave failing job output behind. A run that was cancelled,
// skipped, blocked on approval, or that never started has no logs to fetch, so
// naming it costs a dispatch that finds nothing.
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out"]);

// `gh run list` reports an id as a number, but the event schema carries it as a
// string.
const RunId = z
  .union([z.number(), z.string()])
  .transform(String)
  .catch("") satisfies z.ZodType<string>;

export const AttributionRun = z.looseObject({
  databaseId: RunId,
  headSha: z.string().catch(""),
  conclusion: z.string().catch(""),
  workflowDatabaseId: RunId,
  createdAt: z.string().catch(""),
});
export type AttributionRun = z.infer<typeof AttributionRun>;
const AttributionRuns = z.array(AttributionRun);

// `github:logs` fetches whatever run a failing event names, so a failing event
// must name a run that actually failed. A PR can also fail on a check that is
// no Actions run at all (an external reviewer, a hosted status), which leaves
// nothing to fetch and so no run id.
//
// Collapsing each workflow to its newest run for the commit keeps a failure a
// later run of the same workflow has already replaced from being named again.
// The caller scopes the query by commit; the `headSha` filter is
// belt-and-suspenders over that.
export function selectRunId(runs: AttributionRun[], sha: string): string | null {
  const newestPerWorkflow = new Map<string, AttributionRun>();
  for (const entry of runs) {
    if (entry.headSha !== sha) continue;
    const key =
      entry.workflowDatabaseId !== "" ? entry.workflowDatabaseId : `run:${entry.databaseId}`;
    const seen = newestPerWorkflow.get(key);
    if (!seen || entry.createdAt > seen.createdAt) newestPerWorkflow.set(key, entry);
  }
  const failed = [...newestPerWorkflow.values()].find((r) =>
    FAILED_CONCLUSIONS.has(r.conclusion.toLowerCase()),
  );
  return failed && failed.databaseId !== "" ? failed.databaseId : null;
}

export function deriveRunListState(run: { status?: string; conclusion?: string }): InternalState {
  const conclusion = (run.conclusion ?? "").toLowerCase();
  if (conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out") {
    return "failing";
  }
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
    return "success";
  }
  const status = (run.status ?? "").toLowerCase();
  if (status === "in_progress") return "running";
  if (status === "queued" || status === "waiting" || status === "pending") return "queued";
  return "running";
}

// Probed uses a `kind` discriminator so callers narrow via switch rather than
// brittle `"empty" in result` / `"notFound" in result` property checks. Only
// probePr populates `branch`; the other probes leave it null.
export type Probed =
  | { kind: "ok"; probe: Probe; branch: string | null }
  | { kind: "error"; rateLimited: boolean; retryAfter: string; stderr: string }
  | { kind: "empty" }
  | { kind: "not-found"; stderr: string };

export function probePr(prNumber: number, repo: string, run: ExecFn = exec): Probed {
  const prResult = run(
    `gh pr view ${prNumber} --repo ${repo} --json headRefOid,headRefName,state,mergeable,mergeStateStatus`,
  );
  if (!prResult.ok) {
    return {
      kind: "error",
      rateLimited: prResult.rateLimited,
      retryAfter: prResult.retryAfter,
      stderr: prResult.stderr,
    };
  }
  let view: z.infer<typeof PrView>;
  try {
    view = PrView.parse(JSON.parse(prResult.stdout));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh pr view returned unparseable JSON for PR #${prNumber}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  const sha = view.headRefOid;
  const branch = view.headRefName;
  const prState = view.state;
  const mergeable = view.mergeable;
  const mergeStateStatus = view.mergeStateStatus;
  if (branch === "") {
    const message = `gh pr view did not include headRefName for PR #${prNumber}`;
    console.error(`${message}; treating as probe failure`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  if (sha === "") {
    const message = `gh pr view did not include headRefOid for PR #${prNumber}`;
    console.error(`${message}; treating as probe failure`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }

  const checksResult = run(
    `gh pr checks ${prNumber} --repo ${repo} --required=false --json state,bucket,name`,
  );
  if (!checksResult.ok) {
    return {
      kind: "error",
      rateLimited: checksResult.rateLimited,
      retryAfter: checksResult.retryAfter,
      stderr: checksResult.stderr,
    };
  }
  let state: InternalState;
  try {
    state = deriveChecksState(
      Checks.parse(JSON.parse(checksResult.stdout !== "" ? checksResult.stdout : "[]")),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh pr checks returned unusable JSON for PR #${prNumber}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }

  // Only a failing event carries a run id, so a green or in-flight poll skips
  // the lookup and its API call.
  let runId: string | null = null;
  if (state === "failing") {
    const runsResult = run(
      `gh run list --repo ${repo} --commit ${sha} --limit ${RUN_LOOKUP_LIMIT} --json databaseId,headSha,conclusion,workflowDatabaseId,createdAt`,
    );
    if (!runsResult.ok) {
      return {
        kind: "error",
        rateLimited: runsResult.rateLimited,
        retryAfter: runsResult.retryAfter,
        stderr: runsResult.stderr,
      };
    }
    try {
      const runs = AttributionRuns.parse(
        JSON.parse(runsResult.stdout !== "" ? runsResult.stdout : "[]"),
      );
      runId = selectRunId(runs, sha);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`gh run list returned unusable JSON for ${repo}@${sha}: ${message}`);
      return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
    }
  }

  return {
    kind: "ok",
    branch,
    probe: { sha, state, runId, mergeable, mergeStateStatus, prState },
  };
}

function buildRunProbe(run: RunView, fallbackRunId: string | null): Probe {
  const rawId = run.databaseId;
  const runId =
    typeof rawId === "number"
      ? String(rawId)
      : typeof rawId === "string" && rawId.length > 0
        ? rawId
        : fallbackRunId;
  return {
    sha: run.headSha,
    state: deriveRunListState(run),
    runId,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    prState: "OPEN",
  };
}

// Branch-mode probe: query the latest run for the branch. If no runs exist yet
// (empty array), signal "empty" so the main loop can skip event emission and
// keep polling without tripping the api-error threshold.
export function probeBranch(repo: string, branch: string, run: ExecFn = exec): Probed {
  const result = run(
    `gh run list --repo ${repo} --branch ${branch} --limit 1 --json databaseId,headSha,status,conclusion`,
  );
  if (!result.ok) {
    return {
      kind: "error",
      rateLimited: result.rateLimited,
      retryAfter: result.retryAfter,
      stderr: result.stderr,
    };
  }
  let runs: RunView[];
  try {
    runs = RunList.parse(JSON.parse(result.stdout !== "" ? result.stdout : "[]"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh run list returned unusable JSON for ${repo}@${branch}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  const latest = runs[0];
  if (!latest) {
    return { kind: "empty" };
  }
  return { kind: "ok", branch: null, probe: buildRunProbe(latest, null) };
}

export function computeInterval(durationsSeconds: number[]): number {
  if (durationsSeconds.length === 0) return NO_HISTORY_INTERVAL_SECONDS;
  const avg = durationsSeconds.reduce((a, b) => a + b, 0) / durationsSeconds.length;
  const buffered = avg + 30;
  return Math.min(600, Math.max(30, Math.round(buffered)));
}

function fetchInterval(branch: string, repo: string | null): number {
  const repoFlag = repo != null && repo !== "" ? `--repo ${repo} ` : "";
  const result = exec(
    `gh run list ${repoFlag}--branch ${branch} --limit 5 --json createdAt,updatedAt,conclusion --jq '[.[] | select(.conclusion == "success") | ((.updatedAt | fromdateiso8601) - (.createdAt | fromdateiso8601))]'`,
  );
  if (!result.ok) {
    console.error(
      `gh run list failed while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${result.stderr.trim()}`,
    );
    return DEFAULT_INTERVAL_SECONDS;
  }
  try {
    const parsed = Durations.parse(JSON.parse(result.stdout !== "" ? result.stdout : "[]"));
    return computeInterval(parsed.filter((n): n is number => typeof n === "number"));
  } catch (err) {
    console.error(
      `gh run list returned unparseable JSON while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return DEFAULT_INTERVAL_SECONDS;
}

export function probeRunId(runId: string, repo: string, run: ExecFn = exec): Probed {
  const result = run(
    `gh run view ${runId} --repo ${repo} --json databaseId,headSha,status,conclusion`,
  );
  if (!result.ok) {
    const lower = result.stderr.toLowerCase();
    const notFound =
      lower.includes("could not resolve") || lower.includes("404") || lower.includes("not found");
    if (notFound) {
      return { kind: "not-found", stderr: result.stderr };
    }
    return {
      kind: "error",
      rateLimited: result.rateLimited,
      retryAfter: result.retryAfter,
      stderr: result.stderr,
    };
  }
  let view: RunView;
  try {
    view = RunView.parse(JSON.parse(result.stdout !== "" ? result.stdout : "{}"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh run view returned unusable JSON for run ${runId}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  return { kind: "ok", branch: null, probe: buildRunProbe(view, runId) };
}

type RunOptions = {
  intervalSeconds: number | null;
  maxMinutes: number;
  queuedTimeoutMinutes: number;
  apiErrorThreshold: number;
} & (
  | { mode: "pr"; prUrl: string }
  | { mode: "branch"; repo: string; branch: string }
  | { mode: "run-id"; repo: string; runId: string }
);

async function watch(options: RunOptions): Promise<void> {
  let prNumber: number | null = null;
  let branch: string | null = null;
  let repo: string | null = null;

  if (options.mode === "pr") {
    const parsed = parsePrUrl(options.prUrl);
    prNumber = parsed.number;
    repo = `${parsed.owner}/${parsed.repo}`;
  } else if (options.mode === "branch") {
    repo = options.repo;
    branch = options.branch;
  } else {
    repo = options.repo;
  }

  // Lazy-computed in PR mode after the first successful probe resolves the
  // branch. In run-id mode we use the default interval. In branch mode we can
  // compute it up front since the branch is known.
  let intervalSeconds: number | null = options.intervalSeconds ?? null;
  if (intervalSeconds === null && options.mode === "branch" && branch !== null) {
    intervalSeconds = fetchInterval(branch, repo);
  }

  const deadline = Date.now() + options.maxMinutes * 60 * 1000;
  let state = initialState();

  while (true) {
    const now = Date.now();
    if (now >= deadline) {
      emit({ type: "max-time-reached", minutes: options.maxMinutes });
      return;
    }

    let result: Probed;
    if (options.mode === "pr" && prNumber !== null) {
      result = probePr(prNumber, repo);
    } else if (options.mode === "branch" && branch !== null) {
      result = probeBranch(repo, branch);
    } else if (options.mode === "run-id") {
      result = probeRunId(options.runId, repo);
    } else {
      throw new Error("Invalid run configuration");
    }

    if (result.kind === "not-found") {
      console.error(`Run not found: ${result.stderr.trim()}`);
      process.exit(1);
    } else if (result.kind === "empty") {
      // No runs yet for this branch. Stay quiet and keep polling.
    } else if (result.kind === "error") {
      if (result.rateLimited) {
        emit({ type: "rate-limited", retry_after: result.retryAfter });
      } else if (result.stderr !== "") {
        // Surface the probe failure so callers see *something* before the
        // api-error threshold is reached. Without this, a misshapen gh
        // command (e.g., schema drift in --json fields) silently retries
        // for ~threshold * interval seconds before emitting any event.
        console.error(`probe failed: ${result.stderr.trim()}`);
      }
      const outcome = registerApiError(state, options.apiErrorThreshold);
      state = outcome.state;
      for (const event of outcome.events) emit(event);
    } else {
      state = clearApiErrors(state);
      if (result.branch != null && result.branch !== "") branch = result.branch;
      // Settle mergeability before deriving events so `conflicts` lands in the
      // same cycle as a stale `success`, ahead of the terminal return below.
      let probe = result.probe;
      if (options.mode === "pr" && prNumber !== null && probeIsUndetermined(probe)) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: each cycle reads state the previous cycle left behind.
        const resolved = await resolveMergeable(prNumber, repo, exec, sleep);
        probe = {
          ...probe,
          mergeable: resolved.mergeable,
          mergeStateStatus: resolved.mergeStateStatus,
        };
      }
      const outcome = deriveEvents(probe, state, now, options.queuedTimeoutMinutes);
      state = outcome.state;
      for (const event of outcome.events) emit(event);

      if (intervalSeconds === null && options.mode === "pr" && branch !== null) {
        intervalSeconds = fetchInterval(branch, repo);
      }

      const terminal = outcome.events.find(
        (e) =>
          e.type === "pr-closed" ||
          e.type === "merged" ||
          (e.type === "status" && e.state === "success") ||
          (options.mode === "run-id" && e.type === "status" && e.state === "failing"),
      );
      if (terminal) return;
    }

    // oxlint-disable-next-line no-await-in-loop -- poll interval between API cycles.
    await sleep((intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000);
  }
}

async function main(): Promise<void> {
  const argv = cli({
    name: "watch",
    flags: {
      pr: { type: String, description: "PR URL (PR mode)" },
      branch: {
        type: String,
        description: "Branch name (branch mode; alternative to --pr)",
      },
      runId: {
        type: String,
        description: "GitHub Actions run ID (run-id mode)",
      },
      repo: {
        type: String,
        description:
          "Repo owner/name (branch and run-id modes; inferred from git remote if omitted)",
      },
      interval: { type: Number, description: "Poll interval override (seconds)" },
      maxMinutes: { type: Number, description: "Wall-clock cap in minutes", default: 60 },
      queuedTimeout: {
        type: Number,
        description: "Queued-state timeout (minutes)",
        default: 15,
      },
      apiErrorThreshold: {
        type: Number,
        description: "Consecutive API errors before emit",
        default: 5,
      },
    },
  });

  const prUrl = argv.flags.pr;
  const branch = argv.flags.branch;
  const runId = argv.flags.runId;

  const modeFlags = [prUrl, branch, runId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (modeFlags.length !== 1) {
    console.error("Pass exactly one of --pr <url>, --branch <name>, or --run-id <id>");
    process.exit(1);
  }

  const common = {
    intervalSeconds: argv.flags.interval ?? null,
    maxMinutes: argv.flags.maxMinutes,
    queuedTimeoutMinutes: argv.flags.queuedTimeout,
    apiErrorThreshold: argv.flags.apiErrorThreshold,
  };

  if (prUrl != null && prUrl !== "") {
    if (argv.flags.repo != null && argv.flags.repo !== "") {
      console.error("--repo only applies in branch or run-id mode");
      process.exit(1);
    }
    await watch({ mode: "pr", prUrl, ...common });
    return;
  }

  const resolveRepo = (): string => {
    if (argv.flags.repo != null && argv.flags.repo !== "") return argv.flags.repo;
    const detected = detectRepoFromGit();
    if (!detected) {
      console.error("Could not infer repo from git remote. Pass --repo <owner/repo>.");
      process.exit(1);
    }
    return `${detected.owner}/${detected.repo}`;
  };

  if (runId != null && runId !== "") {
    await watch({ mode: "run-id", repo: resolveRepo(), runId, ...common });
    return;
  }

  if (branch == null || branch === "") return;
  await watch({ mode: "branch", repo: resolveRepo(), branch, ...common });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
