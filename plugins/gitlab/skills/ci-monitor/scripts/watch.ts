#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: shells out to glab (Go binary) for TLS-bearing API calls

import { type ExecSyncOptions, execSync } from "node:child_process";
import { cli } from "cleye";
import UrlPattern from "url-pattern";

const DEFAULT_INTERVAL_SECONDS = 180;
const NO_HISTORY_INTERVAL_SECONDS = 30;

// GitLab computes mergeability asynchronously: `has_conflicts` is only valid
// once `merge_status` settles. While `unchecked`/`checking`, conflicts read as
// false. Re-querying the MR drives that computation, so the watcher re-polls a
// bounded number of times before deciding the platform is undecided.
const MERGE_STATUS_UNKNOWN_RETRIES = 4;
const MERGE_STATUS_RECHECK_SECONDS = 5;

export type StatusState = "running" | "failing" | "success";
export type InternalState = StatusState | "queued";
export type MrState = "opened" | "closed" | "merged" | "locked";

export type Probe = {
  sha: string;
  state: InternalState;
  runId: string | null;
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
  mrState: MrState;
};

export type Event =
  | { type: "status"; state: StatusState; sha: string; run_id: string | null }
  | { type: "conflicts"; sha: string }
  | { type: "mergeable-unknown"; sha: string }
  | { type: "queued-timeout"; minutes: number }
  | { type: "api-error"; consecutive: number }
  | { type: "rate-limited"; retry_after: string }
  | { type: "pr-closed" }
  | { type: "max-time-reached"; minutes: number };

// `has_conflicts` is GitLab's authoritative conflict flag; `detailed_merge_status`
// reads "conflict" for the same condition and can lead the flag, so checking both
// is belt-and-suspenders. Mergeability is undetermined while merge status is still
// being computed (`unchecked`/`checking`/`preparing`).
function isUndeterminedMergeStatus(mergeStatus: string, detailedMergeStatus: string): boolean {
  return (
    mergeStatus === "unchecked" ||
    mergeStatus === "checking" ||
    detailedMergeStatus === "checking" ||
    detailedMergeStatus === "unchecked" ||
    detailedMergeStatus === "preparing"
  );
}

export function probeIsConflict(probe: Probe): boolean {
  return probe.hasConflicts || probe.detailedMergeStatus === "conflict";
}

export function probeIsUndetermined(probe: Probe): boolean {
  return isUndeterminedMergeStatus(probe.mergeStatus, probe.detailedMergeStatus);
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

  if (probe.mrState === "closed" || probe.mrState === "merged") {
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
    events.push({ type: "pr-closed" });
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

export function parseMrUrl(url: string): {
  project: string;
  projectEncoded: string;
  iid: number;
} {
  const prefix = "https://gitlab.com/";
  if (!url.startsWith(prefix)) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const path = url.slice(prefix.length).replace(/\/$/, "");
  const marker = "/-/merge_requests/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const project = path.slice(0, markerIndex);
  if (!project || !project.includes("/")) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const tailPattern = new UrlPattern(":iid(/*)");
  const tail = path.slice(markerIndex + marker.length);
  const tailMatch = tailPattern.match(tail);
  if (!tailMatch) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const iid = Number.parseInt(tailMatch.iid, 10);
  if (Number.isNaN(iid)) {
    throw new Error(`Invalid MR IID in URL: ${url}`);
  }
  return {
    project,
    projectEncoded: encodeURIComponent(project),
    iid,
  };
}

export function parseProject(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    throw new Error("Empty remote URL");
  }

  const match = trimmed.match(/^(?:ssh:\/\/[^/]+\/|[^@\s]+@[^:]+:|https?:\/\/[^/]+\/)(.+)$/);
  if (!match?.[1]) {
    throw new Error(`Could not parse remote URL: ${remoteUrl}`);
  }

  const cleaned = match[1].replace(/\/$/, "").replace(/\.git$/, "");
  if (!cleaned.includes("/")) {
    throw new Error(`Remote URL missing group/project path: ${remoteUrl}`);
  }
  return cleaned;
}

export function normalizePipelineStatus(status: string): InternalState {
  switch (status) {
    case "success":
      return "success";
    case "failed":
    case "canceled":
      return "failing";
    case "running":
      return "running";
    case "pending":
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "scheduled":
    case "manual":
      return "queued";
    case "skipped":
      return "success";
    default:
      return "running";
  }
}

export function computeInterval(durationsSeconds: number[]): number {
  if (durationsSeconds.length === 0) return NO_HISTORY_INTERVAL_SECONDS;
  const avg = durationsSeconds.reduce((a, b) => a + b, 0) / durationsSeconds.length;
  const buffered = avg + 30;
  return Math.min(600, Math.max(30, Math.round(buffered)));
}

const execOptions: ExecSyncOptions = {
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "pipe"],
};

export type ExecResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string; rateLimited: boolean; retryAfter: string };

export type ExecFn = (command: string) => ExecResult;

function exec(command: string): ExecResult {
  try {
    const stdout = execSync(command, execOptions).toString().trim();
    return { ok: true, stdout };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr ?? "")
        : "";
    // glab does not surface structured rate-limit metadata. Rather than
    // regexing human text we rely on the api-error counter instead.
    return { ok: false, stderr, rateLimited: false, retryAfter: "" };
  }
}

export function isNotFoundError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("404") || lower.includes("not found");
}

function emit(event: Event): void {
  console.log(JSON.stringify(event));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type MrMetadata = {
  sha: string;
  sourceBranch: string;
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
  state: MrState;
};

type MrMetadataResult =
  | { ok: true; metadata: MrMetadata }
  | { ok: false; rateLimited: boolean; retryAfter: string };

function fetchMrMetadata(
  projectEncoded: string,
  iid: number,
  run: ExecFn = exec,
): MrMetadataResult {
  const result = run(`glab api projects/${projectEncoded}/merge_requests/${iid}`);
  if (!result.ok) {
    return { ok: false, rateLimited: result.rateLimited, retryAfter: result.retryAfter };
  }
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const sha = typeof parsed.sha === "string" ? parsed.sha : "";
    const sourceBranch = typeof parsed.source_branch === "string" ? parsed.source_branch : "";
    const hasConflicts = parsed.has_conflicts === true;
    const mergeStatus = typeof parsed.merge_status === "string" ? parsed.merge_status : "";
    const detailedMergeStatus =
      typeof parsed.detailed_merge_status === "string" ? parsed.detailed_merge_status : "";
    const state = (typeof parsed.state === "string" ? parsed.state : "opened") as MrState;
    return {
      ok: true,
      metadata: { sha, sourceBranch, hasConflicts, mergeStatus, detailedMergeStatus, state },
    };
  } catch (err) {
    console.error(
      `glab api returned unparseable JSON for MR !${iid}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
}

export type MergeStatus = {
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
};

// Re-poll the MR until GitLab settles its merge status or the retry budget runs
// out. The act of querying nudges GitLab's background computation, so repeated
// reads converge to a definite value. Returns the last value seen; still
// undetermined after the cap means the caller should fall back to a local merge
// dry-run.
export async function resolveMergeStatus(
  projectEncoded: string,
  iid: number,
  run: ExecFn = exec,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<MergeStatus> {
  let current: MergeStatus = {
    hasConflicts: false,
    mergeStatus: "unchecked",
    detailedMergeStatus: "",
  };
  for (let attempt = 0; attempt < MERGE_STATUS_UNKNOWN_RETRIES; attempt += 1) {
    const result = fetchMrMetadata(projectEncoded, iid, run);
    if (result.ok) {
      current = {
        hasConflicts: result.metadata.hasConflicts,
        mergeStatus: result.metadata.mergeStatus,
        detailedMergeStatus: result.metadata.detailedMergeStatus,
      };
      if (!isUndeterminedMergeStatus(current.mergeStatus, current.detailedMergeStatus)) {
        return current;
      }
    }
    if (attempt < MERGE_STATUS_UNKNOWN_RETRIES - 1) {
      await sleepFn(MERGE_STATUS_RECHECK_SECONDS * 1000);
    }
  }
  return current;
}

type PipelineSummary = { id: string; status: InternalState; sha: string } | null;

type PipelineResult =
  | { ok: true; pipeline: PipelineSummary }
  | { ok: false; rateLimited: boolean; retryAfter: string };

function parsePipeline(
  parsed: Record<string, unknown>,
): { id: string; status: InternalState; sha: string } | null {
  const rawId = parsed.id;
  const id = typeof rawId === "number" || typeof rawId === "string" ? String(rawId) : "";
  if (!id) return null;
  const status = typeof parsed.status === "string" ? parsed.status : "";
  const sha = typeof parsed.sha === "string" ? parsed.sha : "";
  return { id, status: normalizePipelineStatus(status), sha };
}

function fetchPipeline(projectEncoded: string, branch: string): PipelineResult {
  const filter = "[.[] | {id, status, sha}] | .[0] // null";
  const result = exec(
    `glab api 'projects/${projectEncoded}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    return { ok: false, rateLimited: result.rateLimited, retryAfter: result.retryAfter };
  }
  try {
    const parsed = JSON.parse(result.stdout || "null") as Record<string, unknown> | null;
    return { ok: true, pipeline: parsed ? parsePipeline(parsed) : null };
  } catch (err) {
    console.error(
      `glab api returned unparseable JSON for pipelines on ${branch}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
}

type Probed =
  | { ok: true; probe: Probe; sourceBranch: string }
  | { ok: false; rateLimited: boolean; retryAfter: string };

function probeMr(projectEncoded: string, iid: number, cachedBranch: string | null): Probed {
  const mr = fetchMrMetadata(projectEncoded, iid);
  if (!mr.ok) {
    return { ok: false, rateLimited: mr.rateLimited, retryAfter: mr.retryAfter };
  }
  const branch = mr.metadata.sourceBranch || cachedBranch || "";

  let runId: string | null = null;
  let pipelineState: InternalState = "running";
  if (branch) {
    const pipeline = fetchPipeline(projectEncoded, branch);
    if (!pipeline.ok) {
      return { ok: false, rateLimited: pipeline.rateLimited, retryAfter: pipeline.retryAfter };
    }
    if (pipeline.pipeline) {
      runId = pipeline.pipeline.id;
      pipelineState = pipeline.pipeline.status;
    }
  }

  return {
    ok: true,
    sourceBranch: branch,
    probe: {
      sha: mr.metadata.sha,
      state: pipelineState,
      runId,
      hasConflicts: mr.metadata.hasConflicts,
      mergeStatus: mr.metadata.mergeStatus,
      detailedMergeStatus: mr.metadata.detailedMergeStatus,
      mrState: mr.metadata.state,
    },
  };
}

type PipelineByIdResult =
  | { ok: true; pipeline: { id: string; status: InternalState; sha: string } }
  | { ok: false; rateLimited: boolean; retryAfter: string; notFound: boolean };

function fetchPipelineById(projectEncoded: string, pipelineId: string): PipelineByIdResult {
  const filter = "{id, status, sha}";
  const result = exec(
    `glab api 'projects/${projectEncoded}/pipelines/${encodeURIComponent(pipelineId)}' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    return {
      ok: false,
      rateLimited: result.rateLimited,
      retryAfter: result.retryAfter,
      notFound: isNotFoundError(result.stderr),
    };
  }
  try {
    const parsed = JSON.parse(result.stdout || "null") as Record<string, unknown> | null;
    const pipeline = parsed ? parsePipeline(parsed) : null;
    if (!pipeline) {
      // A successful glab call with an empty/null body for a specific pipeline
      // ID is unexpected (404s fail the exec). Surface this as a transient
      // probe failure rather than a notFound (which would exit the watcher).
      console.error(
        `glab api returned empty body for pipeline ${pipelineId}; treating as probe failure`,
      );
      return { ok: false, rateLimited: false, retryAfter: "", notFound: false };
    }
    return { ok: true, pipeline };
  } catch (err) {
    console.error(
      `glab api returned unparseable JSON for pipeline ${pipelineId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "", notFound: false };
  }
}

type ProbedById =
  | { ok: true; probe: Probe }
  | { ok: false; rateLimited: boolean; retryAfter: string; notFound: boolean };

function probePipelineId(projectEncoded: string, pipelineId: string): ProbedById {
  const pipeline = fetchPipelineById(projectEncoded, pipelineId);
  if (!pipeline.ok) {
    return {
      ok: false,
      rateLimited: pipeline.rateLimited,
      retryAfter: pipeline.retryAfter,
      notFound: pipeline.notFound,
    };
  }
  return {
    ok: true,
    probe: {
      sha: pipeline.pipeline.sha,
      state: pipeline.pipeline.status,
      runId: pipeline.pipeline.id,
      hasConflicts: false,
      mergeStatus: "",
      detailedMergeStatus: "",
      mrState: "opened",
    },
  };
}

function probeBranch(projectEncoded: string, branch: string): Probed {
  const pipeline = fetchPipeline(projectEncoded, branch);
  if (!pipeline.ok) {
    return { ok: false, rateLimited: pipeline.rateLimited, retryAfter: pipeline.retryAfter };
  }
  const p = pipeline.pipeline;
  return {
    ok: true,
    sourceBranch: branch,
    probe: {
      sha: p?.sha ?? "",
      state: p?.status ?? "running",
      runId: p?.id ?? null,
      hasConflicts: false,
      mergeStatus: "",
      detailedMergeStatus: "",
      mrState: "opened",
    },
  };
}

function fetchInterval(projectEncoded: string, branch: string): number {
  const filter =
    "[.[] | select(.finished_at != null) | ((.finished_at | fromdateiso8601) - (.started_at // .created_at | fromdateiso8601))]";
  const result = exec(
    `glab api 'projects/${projectEncoded}/pipelines?ref=${encodeURIComponent(branch)}&per_page=5' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    console.error(
      `glab api failed while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${result.stderr.trim()}`,
    );
    return DEFAULT_INTERVAL_SECONDS;
  }
  try {
    const parsed = JSON.parse(result.stdout || "[]");
    if (Array.isArray(parsed)) {
      const numbers = parsed.filter((n): n is number => typeof n === "number" && n > 0);
      return computeInterval(numbers);
    }
    console.error(
      `glab api returned non-array JSON while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s`,
    );
  } catch (err) {
    console.error(
      `glab api returned unparseable JSON while computing poll interval for ${branch}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return DEFAULT_INTERVAL_SECONDS;
}

function detectProjectFromRemote(): string | null {
  const result = exec("git remote get-url origin");
  if (!result.ok || !result.stdout) return null;
  try {
    return parseProject(result.stdout);
  } catch {
    return null;
  }
}

type RunTarget =
  | { mode: "mr"; mrUrl: string }
  | { mode: "branch"; project: string; branch: string }
  | { mode: "pipeline-id"; project: string; pipelineId: string };

type RunOptions = {
  target: RunTarget;
  intervalSeconds: number | null;
  maxMinutes: number;
  queuedTimeoutMinutes: number;
  apiErrorThreshold: number;
};

type ProbeOutcome =
  | { ok: true; probe: Probe; sourceBranch: string | null }
  | { ok: false; rateLimited: boolean; retryAfter: string; notFound: boolean };

function isTerminal(events: Event[], mode: RunTarget["mode"]): boolean {
  return events.some(
    (e) =>
      e.type === "pr-closed" ||
      (e.type === "status" && e.state === "success") ||
      (mode === "pipeline-id" && e.type === "status" && e.state === "failing"),
  );
}

async function run(options: RunOptions): Promise<void> {
  const target = options.target;
  let projectEncoded: string;
  let iid: number | null = null;
  if (target.mode === "mr") {
    const parsed = parseMrUrl(target.mrUrl);
    projectEncoded = parsed.projectEncoded;
    iid = parsed.iid;
  } else {
    projectEncoded = encodeURIComponent(target.project);
  }

  const doProbe = (cachedBranch: string | null): ProbeOutcome => {
    if (target.mode === "mr" && iid !== null) {
      const r = probeMr(projectEncoded, iid, cachedBranch);
      if (!r.ok) {
        return { ok: false, rateLimited: r.rateLimited, retryAfter: r.retryAfter, notFound: false };
      }
      return { ok: true, probe: r.probe, sourceBranch: r.sourceBranch };
    }
    if (target.mode === "branch") {
      const r = probeBranch(projectEncoded, target.branch);
      if (!r.ok) {
        return { ok: false, rateLimited: r.rateLimited, retryAfter: r.retryAfter, notFound: false };
      }
      return { ok: true, probe: r.probe, sourceBranch: r.sourceBranch };
    }
    if (target.mode === "pipeline-id") {
      const r = probePipelineId(projectEncoded, target.pipelineId);
      if (!r.ok) {
        return {
          ok: false,
          rateLimited: r.rateLimited,
          retryAfter: r.retryAfter,
          notFound: r.notFound,
        };
      }
      return { ok: true, probe: r.probe, sourceBranch: null };
    }
    throw new Error("Invalid watcher target state");
  };

  let state = initialState();
  let branch: string | null = null;
  let intervalSeconds: number | null = options.intervalSeconds;
  const deadline = Date.now() + options.maxMinutes * 60 * 1000;

  while (true) {
    const now = Date.now();
    if (now >= deadline) {
      emit({ type: "max-time-reached", minutes: options.maxMinutes });
      return;
    }

    const result = doProbe(branch);
    if (!result.ok) {
      if (target.mode === "pipeline-id" && result.notFound) {
        console.error(`Pipeline ${target.pipelineId} not found in project ${target.project}`);
        process.exit(1);
      }
      if (result.rateLimited) {
        emit({ type: "rate-limited", retry_after: result.retryAfter });
      }
      const errOutcome = registerApiError(state, options.apiErrorThreshold);
      state = errOutcome.state;
      for (const event of errOutcome.events) emit(event);
    } else {
      state = clearApiErrors(state);
      if (result.sourceBranch) branch = result.sourceBranch;
      // Settle merge status before deriving events so `conflicts` lands in the
      // same cycle as a stale `success`, ahead of the terminal return below.
      let probe = result.probe;
      if (target.mode === "mr" && iid !== null && probeIsUndetermined(probe)) {
        const resolved = await resolveMergeStatus(projectEncoded, iid, exec, sleep);
        probe = {
          ...probe,
          hasConflicts: resolved.hasConflicts,
          mergeStatus: resolved.mergeStatus,
          detailedMergeStatus: resolved.detailedMergeStatus,
        };
      }
      const outcome = deriveEvents(probe, state, now, options.queuedTimeoutMinutes);
      state = outcome.state;
      for (const event of outcome.events) emit(event);
      if (isTerminal(outcome.events, target.mode)) return;

      intervalSeconds ??=
        target.mode === "pipeline-id" || !branch
          ? DEFAULT_INTERVAL_SECONDS
          : fetchInterval(projectEncoded, branch);
    }

    await sleep((intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000);
  }
}

async function main(): Promise<void> {
  const argv = cli({
    name: "watch",
    flags: {
      mr: { type: String, description: "MR URL (MR mode)" },
      branch: {
        type: String,
        description: "Branch name (branch mode; alternative to --mr)",
      },
      pipelineId: {
        type: String,
        description: "GitLab pipeline ID (pipeline-id mode)",
      },
      project: {
        type: String,
        description:
          "Project path group/name (branch and pipeline-id modes; inferred from git remote if omitted)",
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

  const mrUrl = argv.flags.mr;
  const branch = argv.flags.branch;
  const pipelineId = argv.flags.pipelineId;

  const modeCount = [mrUrl, branch, pipelineId].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  ).length;
  if (modeCount !== 1) {
    console.error("Specify exactly one of --mr <url>, --branch <name>, or --pipeline-id <id>");
    process.exit(1);
  }

  let target: RunTarget;
  if (mrUrl) {
    target = { mode: "mr", mrUrl };
  } else if (branch) {
    const project = argv.flags.project ?? detectProjectFromRemote();
    if (!project) {
      console.error("Could not infer project from git remote. Pass --project <group/project>.");
      process.exit(1);
    }
    target = { mode: "branch", project, branch };
  } else if (pipelineId) {
    const project = argv.flags.project ?? detectProjectFromRemote();
    if (!project) {
      console.error("Could not infer project from git remote. Pass --project <group/project>.");
      process.exit(1);
    }
    target = { mode: "pipeline-id", project, pipelineId };
  } else {
    // Unreachable: the XOR check above guarantees one flag is set.
    throw new Error("No target specified");
  }

  await run({
    target,
    intervalSeconds: argv.flags.interval ?? null,
    maxMinutes: argv.flags.maxMinutes,
    queuedTimeoutMinutes: argv.flags.queuedTimeout,
    apiErrorThreshold: argv.flags.apiErrorThreshold,
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
