#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";
import { cli } from "cleye";
import UrlPattern from "url-pattern";

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
  const match = pattern.match(url);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }
  const number = Number.parseInt(match.number, 10);
  if (Number.isNaN(number)) {
    throw new Error(`Invalid PR number in URL: ${url}`);
  }
  return { owner: match.owner, repo: match.repo, number };
}

export function parseRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  const stripGit = (s: string): string => (s.endsWith(".git") ? s.slice(0, -4) : s);

  const tryPattern = (pattern: string): { owner: string; repo: string } | null => {
    const match = new UrlPattern(pattern, {
      segmentValueCharset: "a-zA-Z0-9-_.~%",
    }).match(trimmed);
    return match ? { owner: match.owner, repo: stripGit(match.repo) } : null;
  };

  const urlMatch =
    tryPattern("https\\://github.com/:owner/:repo(/*)") ??
    tryPattern("ssh\\://git@github.com/:owner/:repo(/*)");
  if (urlMatch) return urlMatch;

  // scp-like: git@github.com:owner/repo(.git)
  const scpMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (scpMatch?.[1] && scpMatch[2]) {
    return { owner: scpMatch[1], repo: stripGit(scpMatch[2]) };
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

function exec(command: string): ExecResult {
  try {
    const stdout = execSync(command, execOptions).toString().trim();
    return { ok: true, stdout };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "";
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
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const mergeable =
      typeof parsed.mergeable === "string" && parsed.mergeable
        ? (parsed.mergeable as Probe["mergeable"])
        : "UNKNOWN";
    const mergeStateStatus =
      typeof parsed.mergeStateStatus === "string" && parsed.mergeStateStatus
        ? (parsed.mergeStateStatus as MergeStateStatus)
        : "UNKNOWN";
    return { mergeable, mergeStateStatus };
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
  run: ExecFn = exec,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<Mergeability> {
  let current: Mergeability = { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" };
  for (let attempt = 0; attempt < MERGEABLE_UNKNOWN_RETRIES; attempt += 1) {
    const result = run(`gh pr view ${prNumber} --json mergeable,mergeStateStatus`);
    if (result.ok) {
      const parsed = parseMergeability(result.stdout);
      if (parsed) {
        current = parsed;
        if (!mergeabilityUndetermined(current)) return current;
      }
    }
    if (attempt < MERGEABLE_UNKNOWN_RETRIES - 1) {
      await sleepFn(MERGEABLE_RECHECK_SECONDS * 1000);
    }
  }
  return current;
}

// `gh pr checks --json` exposes a unified `state` (status when in-flight,
// conclusion when complete) and a normalized `bucket` ("pass" | "fail" |
// "cancel" | "pending" | "skipping"). It does NOT expose `conclusion`. Use
// `bucket` for terminal classification and `state` to distinguish running
// from queued.
export function deriveChecksState(
  checks: Array<{ state?: string; bucket?: string; name?: string }>,
): InternalState {
  if (checks.length === 0) {
    return "running";
  }
  const buckets = checks.map((c) => (c.bucket ?? "").toLowerCase());
  if (buckets.some((b) => b === "fail" || b === "cancel")) {
    return "failing";
  }
  const states = checks.map((c) => (c.state ?? "").toUpperCase());
  if (states.some((s) => s === "IN_PROGRESS")) return "running";
  const isQueuedState = (s: string): boolean =>
    s === "QUEUED" || s === "PENDING" || s === "WAITING" || s === "REQUESTED" || s === "EXPECTED";
  const anyQueued = states.some(isQueuedState);
  const allQueued = states.every(isQueuedState);
  if (allQueued && anyQueued) return "queued";
  if (anyQueued) return "running";
  if (buckets.every((b) => b === "pass" || b === "skipping")) return "success";
  return "running";
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

export function probePr(prNumber: number, run: ExecFn = exec): Probed {
  const prResult = run(
    `gh pr view ${prNumber} --json headRefOid,headRefName,state,mergeable,mergeStateStatus`,
  );
  if (!prResult.ok) {
    return {
      kind: "error",
      rateLimited: prResult.rateLimited,
      retryAfter: prResult.retryAfter,
      stderr: prResult.stderr,
    };
  }
  let sha = "";
  let branch = "";
  let prState: Probe["prState"] = "OPEN";
  let mergeable: Probe["mergeable"] = "UNKNOWN";
  let mergeStateStatus: MergeStateStatus = "UNKNOWN";
  try {
    const parsed = JSON.parse(prResult.stdout) as Record<string, unknown>;
    if (typeof parsed.headRefOid === "string") sha = parsed.headRefOid;
    if (typeof parsed.headRefName === "string") branch = parsed.headRefName;
    if (typeof parsed.state === "string") prState = parsed.state as Probe["prState"];
    if (typeof parsed.mergeable === "string" && parsed.mergeable) {
      mergeable = parsed.mergeable as Probe["mergeable"];
    }
    if (typeof parsed.mergeStateStatus === "string" && parsed.mergeStateStatus) {
      mergeStateStatus = parsed.mergeStateStatus as MergeStateStatus;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh pr view returned unparseable JSON for PR #${prNumber}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  if (!branch) {
    const message = `gh pr view did not include headRefName for PR #${prNumber}`;
    console.error(`${message}; treating as probe failure`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }

  const checksResult = run(`gh pr checks ${prNumber} --required=false --json state,bucket,name`);
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
    const parsed = JSON.parse(checksResult.stdout || "[]");
    if (!Array.isArray(parsed)) {
      const message = `gh pr checks returned non-array JSON for PR #${prNumber}`;
      console.error(`${message}; treating as probe failure`);
      return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
    }
    state = deriveChecksState(parsed as Record<string, unknown>[]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh pr checks returned unparseable JSON for PR #${prNumber}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }

  const runIdResult = run(
    `gh run list --branch ${branch} --limit 1 --json databaseId --jq '.[0].databaseId // ""'`,
  );
  if (!runIdResult.ok) {
    return {
      kind: "error",
      rateLimited: runIdResult.rateLimited,
      retryAfter: runIdResult.retryAfter,
      stderr: runIdResult.stderr,
    };
  }
  const runId = runIdResult.stdout ? runIdResult.stdout : null;

  return {
    kind: "ok",
    branch,
    probe: { sha, state, runId, mergeable, mergeStateStatus, prState },
  };
}

function buildRunProbe(run: Record<string, unknown>, fallbackRunId: string | null): Probe {
  const headSha = typeof run.headSha === "string" ? run.headSha : "";
  const rawId = run.databaseId;
  const runId =
    typeof rawId === "number"
      ? String(rawId)
      : typeof rawId === "string" && rawId.length > 0
        ? rawId
        : fallbackRunId;
  const status = typeof run.status === "string" ? run.status : "";
  const conclusion = typeof run.conclusion === "string" ? run.conclusion : "";
  return {
    sha: headSha,
    state: deriveRunListState({ status, conclusion }),
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout || "[]");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh run list returned unparseable JSON for ${repo}@${branch}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { kind: "empty" };
  }
  const rawRun = parsed[0];
  if (!rawRun || typeof rawRun !== "object") {
    return { kind: "empty" };
  }
  return {
    kind: "ok",
    branch: null,
    probe: buildRunProbe(rawRun as Record<string, unknown>, null),
  };
}

export function computeInterval(durationsSeconds: number[]): number {
  if (durationsSeconds.length === 0) return NO_HISTORY_INTERVAL_SECONDS;
  const avg = durationsSeconds.reduce((a, b) => a + b, 0) / durationsSeconds.length;
  const buffered = avg + 30;
  return Math.min(600, Math.max(30, Math.round(buffered)));
}

function fetchInterval(branch: string, repo: string | null): number {
  const repoFlag = repo ? `--repo ${repo} ` : "";
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
    const parsed = JSON.parse(result.stdout || "[]");
    if (Array.isArray(parsed)) {
      const numbers = parsed.filter((n): n is number => typeof n === "number");
      return computeInterval(numbers);
    }
    console.error(
      `gh run list returned non-array JSON while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s`,
    );
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh run view returned unparseable JSON for run ${runId}: ${message}`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  if (!parsed || typeof parsed !== "object") {
    const message = `gh run view returned non-object JSON for run ${runId}`;
    console.error(`${message}; treating as probe failure`);
    return { kind: "error", rateLimited: false, retryAfter: "", stderr: message };
  }
  return {
    kind: "ok",
    branch: null,
    probe: buildRunProbe(parsed as Record<string, unknown>, runId),
  };
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

async function run(options: RunOptions): Promise<void> {
  let prNumber: number | null = null;
  let branch: string | null = null;
  let repo: string | null = null;

  if (options.mode === "pr") {
    const parsed = parsePrUrl(options.prUrl);
    prNumber = parsed.number;
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
      result = probePr(prNumber);
    } else if (options.mode === "branch" && repo !== null && branch !== null) {
      result = probeBranch(repo, branch);
    } else if (options.mode === "run-id" && repo !== null) {
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
      } else if (result.stderr) {
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
      if (result.branch) branch = result.branch;
      // Settle mergeability before deriving events so `conflicts` lands in the
      // same cycle as a stale `success`, ahead of the terminal return below.
      let probe = result.probe;
      if (options.mode === "pr" && prNumber !== null && probeIsUndetermined(probe)) {
        const resolved = await resolveMergeable(prNumber, exec, sleep);
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

  if (prUrl) {
    if (argv.flags.repo) {
      console.error("--repo only applies in branch or run-id mode");
      process.exit(1);
    }
    await run({ mode: "pr", prUrl, ...common });
    return;
  }

  const resolveRepo = (): string => {
    if (argv.flags.repo) return argv.flags.repo;
    const detected = detectRepoFromGit();
    if (!detected) {
      console.error("Could not infer repo from git remote. Pass --repo <owner/repo>.");
      process.exit(1);
    }
    return `${detected.owner}/${detected.repo}`;
  };

  if (runId) {
    await run({ mode: "run-id", repo: resolveRepo(), runId, ...common });
    return;
  }

  await run({ mode: "branch", repo: resolveRepo(), branch: branch as string, ...common });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
