#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { cli } from "cleye";
import UrlPattern from "url-pattern";
import { z } from "zod";

const POLL_SECONDS = 30;
const GLAB_TIMEOUT_MS = 60_000;

// GitLab computes mergeability asynchronously: `has_conflicts` is only valid
// once `merge_status` settles. While `unchecked`/`checking`, conflicts read as
// false. Re-querying the MR drives that computation, so the watcher re-polls a
// bounded number of times before deciding the platform is undecided.
const MERGE_STATUS_UNKNOWN_RETRIES = 4;
const MERGE_STATUS_RECHECK_SECONDS = 5;

export type StatusState = "running" | "failing" | "success";
export type InternalState = StatusState | "queued" | "blocked";
export type MrState = "opened" | "closed" | "merged" | "locked";

// url-pattern's match() returns `any`.
const TailMatch = z.looseObject({ iid: z.string() });

const CiPipeline = z.looseObject({
  id: z.number(),
  status: z.string().catch(""),
  sha: z.string().catch(""),
  ref: z.string().catch(""),
  jobs: z.array(z.unknown()).catch([]),
});

const JobEntry = z.looseObject({
  name: z.string().catch(""),
  status: z.string().catch(""),
  allow_failure: z.boolean().catch(false),
});

const MrView = z.looseObject({
  sha: z.string().catch(""),
  has_conflicts: z.boolean().catch(false),
  merge_status: z.string().catch(""),
  detailed_merge_status: z.string().catch(""),
  state: z
    .enum(["opened", "closed", "merged", "locked"])
    .catch("opened") satisfies z.ZodType<MrState>,
});

export interface Probe {
  sha: string;
  state: InternalState;
  runId: string | null;
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
  mrState: MrState;
}

export type Event =
  | { type: "status"; state: StatusState; sha: string; run_id: string | null }
  | { type: "blocked"; sha: string; run_id: string | null }
  | { type: "conflicts"; sha: string }
  | { type: "mergeable-unknown"; sha: string }
  | { type: "queued-timeout"; minutes: number }
  | { type: "api-error"; consecutive: number }
  | { type: "fatal"; message: string }
  | { type: "pr-closed" }
  | { type: "merged" }
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

export interface WatcherState {
  lastSha: string | null;
  lastState: StatusState | null;
  queuedSince: number | null;
  queuedTimeoutEmitted: boolean;
  apiErrorCount: number;
  emittedConflictsForSha: string | null;
  mergeableUnknownEmittedForSha: string | null;
  blockedEmittedForRun: string | null;
}

export function initialState(): WatcherState {
  return {
    lastSha: null,
    lastState: null,
    queuedSince: null,
    queuedTimeoutEmitted: false,
    apiErrorCount: 0,
    emittedConflictsForSha: null,
    mergeableUnknownEmittedForSha: null,
    blockedEmittedForRun: null,
  };
}

function mapToEmitState(state: InternalState): StatusState {
  return state === "queued" || state === "blocked" ? "running" : state;
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
    events.push(probe.mrState === "merged" ? { type: "merged" } : { type: "pr-closed" });
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

  if (probe.state === "blocked") {
    if (next.blockedEmittedForRun !== probe.runId) {
      events.push({ type: "blocked", sha: probe.sha, run_id: probe.runId });
      next = { ...next, blockedEmittedForRun: probe.runId };
    }
  } else if (next.blockedEmittedForRun !== null) {
    next = { ...next, blockedEmittedForRun: null };
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
  } else if (next.queuedSince !== null || next.queuedTimeoutEmitted) {
    next = { ...next, queuedSince: null, queuedTimeoutEmitted: false };
  }

  return { events, state: next };
}

export function registerApiError(
  state: WatcherState,
  threshold: number,
): { events: Event[]; state: WatcherState } {
  const count = state.apiErrorCount + 1;
  const events: Event[] = count === threshold ? [{ type: "api-error", consecutive: count }] : [];
  return { events, state: { ...state, apiErrorCount: count } };
}

export function clearApiErrors(state: WatcherState): WatcherState {
  return state.apiErrorCount === 0 ? state : { ...state, apiErrorCount: 0 };
}

export function parseMrUrl(url: string): {
  project: string;
  projectEncoded: string;
  iid: number;
} {
  const path = new URL(url).pathname.slice(1).replace(/\/$/, "");
  const marker = "/-/merge_requests/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const project = path.slice(0, markerIndex);
  if (project === "" || !project.includes("/")) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const tailPattern = new UrlPattern(":iid(/*)");
  const tail = path.slice(markerIndex + marker.length);
  const tailMatch = TailMatch.safeParse(tailPattern.match(tail));
  if (!tailMatch.success) {
    throw new Error(`Invalid GitLab MR URL: ${url}`);
  }
  const iid = Number.parseInt(tailMatch.data.iid, 10);
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
  if (trimmed === "") {
    throw new Error("Empty remote URL");
  }

  const path = trimmed.match(/^(?:ssh:\/\/[^/]+\/|[^@\s]+@[^:]+:|https?:\/\/[^/]+\/)(.+)$/)?.at(1);
  if (path == null || path === "") {
    throw new Error(`Could not parse remote URL: ${remoteUrl}`);
  }

  const cleaned = path.replace(/\/$/, "").replace(/\.git$/, "");
  if (!cleaned.includes("/")) {
    throw new Error(`Remote URL missing group/project path: ${remoteUrl}`);
  }
  return cleaned;
}

export function normalizePipelineStatus(status: string): InternalState {
  switch (status) {
    case "success":
    case "skipped":
      return "success";
    case "failed":
    case "canceled":
      return "failing";
    case "running":
      return "running";
    case "manual":
      return "blocked";
    case "pending":
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "scheduled":
      return "queued";
    default:
      return "running";
  }
}

export interface JobRecord {
  name: string;
  status: string;
  allowFailure: boolean;
}

// Job data can only downgrade a claimed success, never confirm one: bridge
// (trigger) jobs are absent from the job list, so a pipeline whose work lives in
// child pipelines legitimately reports zero jobs, as does a `skipped` pipeline.
// A `canceled` job is left out because cancellation already turns the pipeline
// `canceled`.
export function jobsContradictSuccess(jobs: JobRecord[]): JobRecord[] {
  return jobs.filter((job) => job.status === "failed" && !job.allowFailure);
}

export type RunResult = { ok: true; stdout: string } | { ok: false; stderr: string };
export type Run = (args: string[]) => RunResult;
export type Sleep = (ms: number) => Promise<void>;

function streamText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

const glab: Run = (args) => {
  try {
    const stdout = execFileSync("glab", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GLAB_TIMEOUT_MS,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? streamText(error.stderr)
            .trim()
            .replaceAll(/\s+/g, " ")
            .replace(/^ERROR /, "")
        : "";
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, stderr: stderr !== "" ? stderr : message };
  }
};

// A retry cannot fix 401, 403, or 404.
export function isFatalError(stderr: string): boolean {
  return /\b(401 Unauthorized|403 Forbidden|404 Not Found)\b/i.test(stderr);
}

export interface Failure {
  ok: false;
  fatal: boolean;
  stderr: string;
}

function failure(stderr: string): Failure {
  return { ok: false, fatal: isFatalError(stderr), stderr };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MrMetadata {
  sha: string;
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
  state: MrState;
}

function fetchMr(
  run: Run,
  project: string,
  iid: number,
): { ok: true; metadata: MrMetadata } | Failure {
  const result = run(["mr", "view", String(iid), "-R", project, "-F", "json"]);
  if (!result.ok) return failure(result.stderr);
  try {
    const parsed = MrView.parse(JSON.parse(result.stdout));
    return {
      ok: true,
      metadata: {
        sha: parsed.sha,
        hasConflicts: parsed.has_conflicts,
        mergeStatus: parsed.merge_status,
        detailedMergeStatus: parsed.detailed_merge_status,
        state: parsed.state,
      },
    };
  } catch (error) {
    return failure(`unparseable output for MR !${iid}: ${describeError(error)}`);
  }
}

export interface MergeStatus {
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
}

// Re-polling the MR nudges GitLab's background mergeability computation, so
// repeated reads converge.
export async function resolveMergeStatus(
  project: string,
  iid: number,
  run: Run = glab,
  sleep: Sleep = Bun.sleep,
): Promise<MergeStatus> {
  let current: MergeStatus = {
    hasConflicts: false,
    mergeStatus: "unchecked",
    detailedMergeStatus: "",
  };
  for (let attempt = 0; attempt < MERGE_STATUS_UNKNOWN_RETRIES; attempt += 1) {
    const result = fetchMr(run, project, iid);
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
      // oxlint-disable-next-line no-await-in-loop -- backoff between merge-status rechecks.
      await sleep(MERGE_STATUS_RECHECK_SECONDS * 1000);
    }
  }
  return current;
}

interface PipelineSnapshot {
  id: string;
  state: InternalState;
  sha: string;
  ref: string;
}

// `null` means GitLab has no pipeline for the target yet.
type PipelineFetch = { ok: true; pipeline: PipelineSnapshot | null } | Failure;

export type PipelineSelector =
  | { kind: "mr"; iid: number }
  | { kind: "branch"; branch: string }
  | { kind: "id"; id: string };

function selectorArgs(selector: PipelineSelector): string[] {
  if (selector.kind === "mr") return ["--merge-request", String(selector.iid)];
  if (selector.kind === "branch") return ["--branch", selector.branch];
  return ["--pipeline-id", selector.id];
}

function confirmState(status: InternalState, jobs: unknown[], pipelineId: string): InternalState {
  if (status !== "success") return status;
  const records: JobRecord[] = [];
  for (const entry of jobs) {
    const fields = JobEntry.safeParse(entry);
    if (!fields.success) continue;
    records.push({
      name: fields.data.name,
      status: fields.data.status,
      allowFailure: fields.data.allow_failure,
    });
  }
  const contradicting = jobsContradictSuccess(records);
  if (contradicting.length > 0) {
    console.error(
      `pipeline ${pipelineId} reports success but required jobs failed: ${contradicting.map((job) => job.name).join(", ")}`,
    );
    return "failing";
  }
  return "success";
}

export function fetchPipeline(
  run: Run,
  project: string,
  selector: PipelineSelector,
): PipelineFetch {
  const result = run([
    "ci",
    "get",
    "-R",
    project,
    ...selectorArgs(selector),
    "-F",
    "json",
    "--with-job-details",
  ]);
  if (!result.ok) {
    if (!isFatalError(result.stderr) && /no pipeline found/i.test(result.stderr)) {
      return { ok: true, pipeline: null };
    }
    return failure(result.stderr);
  }
  try {
    const parsed = CiPipeline.parse(JSON.parse(result.stdout));
    const id = String(parsed.id);
    return {
      ok: true,
      pipeline: {
        id,
        state: confirmState(normalizePipelineStatus(parsed.status), parsed.jobs, id),
        sha: parsed.sha,
        ref: parsed.ref,
      },
    };
  } catch (error) {
    return failure(`unparseable pipeline output: ${describeError(error)}`);
  }
}

const MERGE_REF = /^refs\/merge-requests\/\d+\/merge$/;

// A merged-results pipeline runs on an ephemeral merge commit, so only other
// pipeline kinds can be compared against the MR head sha.
export function isStalePipeline(pipeline: PipelineSnapshot, mrSha: string): boolean {
  return !MERGE_REF.test(pipeline.ref) && pipeline.sha !== mrSha;
}

export type Probed = { ok: true; probe: Probe } | Failure;

function openProbe(sha: string, pipeline: PipelineSnapshot | null): Probe {
  return {
    sha,
    state: pipeline?.state ?? "running",
    runId: pipeline?.id ?? null,
    hasConflicts: false,
    mergeStatus: "",
    detailedMergeStatus: "",
    mrState: "opened",
  };
}

export function probeMr(run: Run, project: string, iid: number): Probed {
  const mr = fetchMr(run, project, iid);
  if (!mr.ok) return mr;
  const fetched = fetchPipeline(run, project, { kind: "mr", iid });
  if (!fetched.ok) return fetched;
  const pipeline =
    fetched.pipeline !== null && isStalePipeline(fetched.pipeline, mr.metadata.sha)
      ? null
      : fetched.pipeline;
  return {
    ok: true,
    probe: {
      ...openProbe(mr.metadata.sha, pipeline),
      hasConflicts: mr.metadata.hasConflicts,
      mergeStatus: mr.metadata.mergeStatus,
      detailedMergeStatus: mr.metadata.detailedMergeStatus,
      mrState: mr.metadata.state,
    },
  };
}

export function probePipeline(
  run: Run,
  project: string,
  selector: Extract<PipelineSelector, { kind: "branch" | "id" }>,
): Probed {
  const fetched = fetchPipeline(run, project, selector);
  if (!fetched.ok) return fetched;
  return { ok: true, probe: openProbe(fetched.pipeline?.sha ?? "", fetched.pipeline) };
}

function detectProjectFromRemote(): string | null {
  try {
    const stdout = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GLAB_TIMEOUT_MS,
    });
    return parseProject(stdout);
  } catch {
    // No git, no origin remote, or an unrecognized URL: the caller asks for --project.
    return null;
  }
}

export type RunTarget =
  | { mode: "mr"; mrUrl: string }
  | { mode: "branch"; project: string; branch: string }
  | { mode: "pipeline-id"; project: string; pipelineId: string };

export interface WatchOptions {
  target: RunTarget;
  maxMinutes: number;
  queuedTimeoutMinutes: number;
  apiErrorThreshold: number;
}

export interface WatchDeps {
  run: Run;
  sleep: Sleep;
  now: () => number;
  emit: (event: Event) => void;
  log: (message: string) => void;
}

const defaultDeps: WatchDeps = {
  run: glab,
  sleep: Bun.sleep,
  now: Date.now,
  emit: (event) => {
    console.log(JSON.stringify(event));
  },
  log: (message) => {
    console.error(message);
  },
};

function isTerminal(events: Event[]): boolean {
  return events.some(
    (e) =>
      e.type === "pr-closed" ||
      e.type === "merged" ||
      (e.type === "status" && e.state === "success"),
  );
}

// Resolves to the process exit code.
export async function watchLoop(
  options: WatchOptions,
  overrides: Partial<WatchDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  const { target } = options;
  const mr = target.mode === "mr" ? parseMrUrl(target.mrUrl) : null;
  const project = mr?.project ?? (target.mode === "mr" ? "" : target.project);

  const probe = (): Probed => {
    if (mr !== null) return probeMr(deps.run, project, mr.iid);
    if (target.mode === "branch") {
      return probePipeline(deps.run, project, { kind: "branch", branch: target.branch });
    }
    if (target.mode === "pipeline-id") {
      return probePipeline(deps.run, project, { kind: "id", id: target.pipelineId });
    }
    throw new Error("Invalid watcher target state");
  };

  let state = initialState();
  const deadline = deps.now() + options.maxMinutes * 60 * 1000;

  while (true) {
    const now = deps.now();
    if (now >= deadline) {
      deps.emit({ type: "max-time-reached", minutes: options.maxMinutes });
      return 0;
    }

    const result = probe();
    if (!result.ok) {
      if (result.fatal) {
        deps.log(result.stderr);
        deps.emit({ type: "fatal", message: result.stderr });
        return 1;
      }
      const outcome = registerApiError(state, options.apiErrorThreshold);
      state = outcome.state;
      for (const event of outcome.events) deps.emit(event);
    } else {
      state = clearApiErrors(state);
      let current = result.probe;
      // Settle merge status before deriving events so `conflicts` lands in the
      // same cycle as a stale `success`, ahead of the terminal return below.
      if (mr !== null && probeIsUndetermined(current)) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: each cycle reads state the previous cycle left behind.
        const resolved = await resolveMergeStatus(project, mr.iid, deps.run, deps.sleep);
        current = { ...current, ...resolved };
      }
      const outcome = deriveEvents(current, state, now, options.queuedTimeoutMinutes);
      state = outcome.state;
      for (const event of outcome.events) deps.emit(event);
      if (isTerminal(outcome.events)) return 0;
    }

    // oxlint-disable-next-line no-await-in-loop -- poll interval between cycles.
    await deps.sleep(Math.max(0, Math.min(POLL_SECONDS * 1000, deadline - deps.now())));
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
  if (mrUrl != null && mrUrl !== "") {
    target = { mode: "mr", mrUrl };
  } else {
    const project = argv.flags.project ?? detectProjectFromRemote();
    if (project == null || project === "") {
      console.error("Could not infer project from git remote. Pass --project <group/project>.");
      process.exit(1);
    }
    target =
      branch != null && branch !== ""
        ? { mode: "branch", project, branch }
        : { mode: "pipeline-id", project, pipelineId: pipelineId ?? "" };
  }

  const code = await watchLoop({
    target,
    maxMinutes: argv.flags.maxMinutes,
    queuedTimeoutMinutes: argv.flags.queuedTimeout,
    apiErrorThreshold: argv.flags.apiErrorThreshold,
  });
  process.exit(code);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
