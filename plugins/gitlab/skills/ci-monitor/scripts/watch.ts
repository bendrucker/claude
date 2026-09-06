#!/usr/bin/env bun

import { type ExecSyncOptions, execSync } from "node:child_process";
import { streamText } from "../../../scripts/merge";
import { cli } from "cleye";
import UrlPattern from "url-pattern";
import { z } from "zod";

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

const Entries = z.array(z.unknown());

// url-pattern's match() returns `any`.
const TailMatch = z.looseObject({ iid: z.string() });

const PipelineEntry = z.looseObject({
  id: z.union([z.number(), z.string()]).optional().catch(undefined),
  status: z.string().catch(""),
  sha: z.string().catch(""),
  source: z.string().catch(""),
});

const TimedPipeline = z.looseObject({
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const JobEntry = z.looseObject({
  name: z.string().catch(""),
  status: z.string().catch(""),
  allow_failure: z.boolean().catch(false),
});

const MrView = z.looseObject({
  sha: z.string().catch(""),
  source_branch: z.string().catch(""),
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
  | { type: "conflicts"; sha: string }
  | { type: "mergeable-unknown"; sha: string }
  | { type: "queued-timeout"; minutes: number }
  | { type: "api-error"; consecutive: number }
  | { type: "rate-limited"; retry_after: string }
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
  apiErrorEmittedAt: number | null;
  emittedConflictsForSha: string | null;
  mergeableUnknownEmittedForSha: string | null;
}

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

export interface PipelineRecord {
  id: number;
  status: InternalState;
  sha: string;
  source: string;
}

// `external` pipelines are commit-status reports posted by other tools: they
// carry no CI jobs and go green the moment they are created. `parent_pipeline`
// pipelines are children whose status the parent already aggregates, so a green
// child says nothing about the run as a whole. Either one can outrank the real
// pipeline by id and produce a false green.
const EXCLUDED_PIPELINE_SOURCES = new Set(["external", "parent_pipeline"]);

export function parsePipelineList(raw: unknown): PipelineRecord[] | null {
  const entries = Entries.safeParse(raw);
  if (!entries.success) return null;
  const records: PipelineRecord[] = [];
  for (const entry of entries.data) {
    const fields = PipelineEntry.safeParse(entry);
    if (!fields.success) continue;
    const id = Number(fields.data.id);
    // `Number("")` is 0, so an empty id would otherwise become a `run_id` of
    // "0" and get handed to the logs agent as if it were a real pipeline.
    if (!Number.isFinite(id) || id <= 0) continue;
    records.push({
      id,
      status: normalizePipelineStatus(fields.data.status),
      sha: fields.data.sha,
      source: fields.data.source,
    });
  }
  return records;
}

// Both pipeline list endpoints mix pipeline kinds: the MR endpoint returns the
// source branch's push pipelines alongside the MR's own, and the branch-ref
// endpoint returns merge-request pipelines whose stored ref is that branch,
// including ones belonging to other MRs. Preferring the caller's own kind, and
// falling back to the other only when the preferred kind is absent, keeps
// projects that run just one kind working.
export function selectPipeline(
  records: PipelineRecord[],
  prefer: "merge-request" | "branch",
): PipelineRecord | null {
  const eligible = records.filter((record) => !EXCLUDED_PIPELINE_SOURCES.has(record.source));
  const mergeRequestPipelines = eligible.filter(
    (record) => record.source === "merge_request_event",
  );
  const branchPipelines = eligible.filter((record) => record.source !== "merge_request_event");
  const [preferred, fallback] =
    prefer === "merge-request"
      ? [mergeRequestPipelines, branchPipelines]
      : [branchPipelines, mergeRequestPipelines];
  const partition = preferred.length > 0 ? preferred : fallback;
  return partition.reduce<PipelineRecord | null>(
    (best, record) => (best === null || record.id > best.id ? record : best),
    null,
  );
}

export interface JobRecord {
  name: string;
  status: string;
  allowFailure: boolean;
}

// Job data can only ever downgrade a claimed success, never confirm one: the
// jobs endpoint omits bridge (trigger) jobs, so a pipeline whose work lives in
// child pipelines legitimately reports zero jobs, as does a `skipped` pipeline.
// A `canceled` job is left out on purpose, since cancellation already turns the
// pipeline `canceled` and widening the rule risks rejecting healthy greens.
export function jobsContradictSuccess(jobs: JobRecord[]): JobRecord[] {
  return jobs.filter((job) => job.status === "failed" && !job.allowFailure);
}

// Statuses whose elapsed time reflects CI work actually running. `skipped` and
// `manual` pipelines finish in about a second without doing anything, so
// averaging them in would collapse the interval toward the floor.
const TIMED_PIPELINE_STATUSES = new Set(["success", "failed", "canceled"]);

// The pipeline list endpoint carries no `finished_at`, `started_at`, or
// `duration`, so elapsed time has to come from `updated_at - created_at`. On a
// finished pipeline the two agree to within about three seconds, and `duration`
// would be wrong here regardless: it excludes queue time, which a poller waits
// through. Dates are parsed here rather than in jq because `fromdateiso8601`
// rejects the fractional seconds GitLab sends.
export function pipelineDurations(raw: unknown[]): number[] {
  const durations: number[] = [];
  for (const entry of raw) {
    const record = TimedPipeline.safeParse(entry);
    if (!record.success) continue;
    if (!TIMED_PIPELINE_STATUSES.has(record.data.status)) continue;
    const started = Date.parse(record.data.created_at);
    const ended = Date.parse(record.data.updated_at);
    if (Number.isNaN(started) || Number.isNaN(ended)) continue;
    const seconds = (ended - started) / 1000;
    if (seconds > 0) durations.push(seconds);
  }
  return durations;
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
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? streamText(error.stderr)
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

interface MrMetadata {
  sha: string;
  sourceBranch: string;
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
  state: MrState;
}

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
    const parsed = MrView.parse(JSON.parse(result.stdout));
    return {
      ok: true,
      metadata: {
        sha: parsed.sha,
        sourceBranch: parsed.source_branch,
        hasConflicts: parsed.has_conflicts,
        mergeStatus: parsed.merge_status,
        detailedMergeStatus: parsed.detailed_merge_status,
        state: parsed.state,
      },
    };
  } catch (error) {
    console.error(
      `glab api returned unparseable JSON for MR !${iid}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
}

export interface MergeStatus {
  hasConflicts: boolean;
  mergeStatus: string;
  detailedMergeStatus: string;
}

// Re-poll the MR until GitLab settles its merge status or the retry budget runs
// out. The act of querying nudges GitLab's background computation, so repeated
// reads converge to a definite value. Returns the last value seen; still
// undetermined after the cap means the caller should fall back to a local merge
// dry-run.
export async function resolveMergeStatus(
  projectEncoded: string,
  iid: number,
  run: ExecFn = exec,
  sleepFn: (ms: number) => Promise<void> = Bun.sleep,
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
      // oxlint-disable-next-line no-await-in-loop -- backoff between merge-status rechecks.
      await sleepFn(MERGE_STATUS_RECHECK_SECONDS * 1000);
    }
  }
  return current;
}

function parsePipeline(parsed: unknown): { id: string; status: InternalState; sha: string } | null {
  const fields = PipelineEntry.safeParse(parsed);
  if (!fields.success) return null;
  const id = fields.data.id === undefined ? "" : String(fields.data.id);
  if (id === "") return null;
  return { id, status: normalizePipelineStatus(fields.data.status), sha: fields.data.sha };
}

export type PipelineTarget = { kind: "mr"; iid: number } | { kind: "branch"; branch: string };

function pipelineListPath(projectEncoded: string, target: PipelineTarget, perPage: number): string {
  return target.kind === "mr"
    ? `projects/${projectEncoded}/merge_requests/${target.iid}/pipelines?per_page=${perPage}`
    : `projects/${projectEncoded}/pipelines?ref=${encodeURIComponent(target.branch)}&per_page=${perPage}`;
}

function describeTarget(target: PipelineTarget): string {
  return target.kind === "mr" ? `MR !${target.iid}` : `branch ${target.branch}`;
}

type PipelineListResult =
  | { ok: true; records: PipelineRecord[] }
  | { ok: false; rateLimited: boolean; retryAfter: string };

function fetchPipelineList(
  projectEncoded: string,
  target: PipelineTarget,
  run: ExecFn = exec,
): PipelineListResult {
  const filter = "[.[] | {id, status, sha, source}]";
  const result = run(
    `glab api '${pipelineListPath(projectEncoded, target, 20)}' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    return { ok: false, rateLimited: result.rateLimited, retryAfter: result.retryAfter };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout !== "" ? result.stdout : "null");
  } catch (error) {
    console.error(
      `glab api returned unparseable JSON for pipelines on ${describeTarget(target)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
  const records = parsePipelineList(parsed);
  if (!records) {
    console.error(
      `glab api returned non-array JSON for pipelines on ${describeTarget(target)}; treating as probe failure`,
    );
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
  return { ok: true, records };
}

type JobsResult = { ok: true; jobs: JobRecord[] } | { ok: false };

function fetchJobs(projectEncoded: string, pipelineId: string, run: ExecFn = exec): JobsResult {
  const filter = "[.[] | {name, status, allow_failure}]";
  const result = run(
    `glab api 'projects/${projectEncoded}/pipelines/${encodeURIComponent(pipelineId)}/jobs?per_page=100' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    console.error(
      `glab api failed while confirming success for pipeline ${pipelineId}: ${result.stderr.trim()}`,
    );
    return { ok: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout !== "" ? result.stdout : "null");
  } catch (error) {
    console.error(
      `glab api returned unparseable JSON for jobs on pipeline ${pipelineId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false };
  }
  const entries = Entries.safeParse(parsed);
  if (!entries.success) {
    console.error(`glab api returned non-array JSON for jobs on pipeline ${pipelineId}`);
    return { ok: false };
  }
  const jobs: JobRecord[] = [];
  for (const entry of entries.data) {
    const fields = JobEntry.safeParse(entry);
    if (!fields.success) continue;
    jobs.push({
      name: fields.data.name,
      status: fields.data.status,
      allowFailure: fields.data.allow_failure,
    });
  }
  return { ok: true, jobs };
}

type VerifiedState = { ok: true; state: InternalState } | { ok: false };

// Confirm a claimed success against the pipeline's jobs before letting it end
// the watch. Only a claimed success pays for the extra call, so a watch that
// ends green spends exactly one. An unreadable jobs response fails closed: the
// caller turns it into a probe failure and re-polls rather than emitting an
// unverified green.
function verifyState(
  projectEncoded: string,
  pipeline: { id: string; status: InternalState },
  run: ExecFn = exec,
): VerifiedState {
  if (pipeline.status !== "success") {
    return { ok: true, state: pipeline.status };
  }
  const jobs = fetchJobs(projectEncoded, pipeline.id, run);
  if (!jobs.ok) {
    return { ok: false };
  }
  const contradicting = jobsContradictSuccess(jobs.jobs);
  if (contradicting.length > 0) {
    console.error(
      `pipeline ${pipeline.id} reports success but required jobs failed: ${contradicting.map((job) => job.name).join(", ")}`,
    );
    return { ok: true, state: "failing" };
  }
  return { ok: true, state: "success" };
}

type Probed = { ok: true; probe: Probe } | { ok: false; rateLimited: boolean; retryAfter: string };

type SelectedPipeline =
  | { ok: true; runId: string | null; state: InternalState; sha: string }
  | { ok: false; rateLimited: boolean; retryAfter: string };

function resolvePipeline(
  projectEncoded: string,
  target: PipelineTarget,
  prefer: "merge-request" | "branch",
  run: ExecFn,
): SelectedPipeline {
  const pipelines = fetchPipelineList(projectEncoded, target, run);
  if (!pipelines.ok) {
    return { ok: false, rateLimited: pipelines.rateLimited, retryAfter: pipelines.retryAfter };
  }
  const selected = selectPipeline(pipelines.records, prefer);
  // No eligible pipeline leaves the state `running`, so a page of nothing but
  // excluded sources degrades to "keep polling" instead of to a green.
  if (!selected) {
    return { ok: true, runId: null, state: "running", sha: "" };
  }
  const id = String(selected.id);
  const verified = verifyState(projectEncoded, { id, status: selected.status }, run);
  if (!verified.ok) {
    return { ok: false, rateLimited: false, retryAfter: "" };
  }
  return { ok: true, runId: id, state: verified.state, sha: selected.sha };
}

export function probeMr(projectEncoded: string, iid: number, run: ExecFn = exec): Probed {
  const mr = fetchMrMetadata(projectEncoded, iid, run);
  if (!mr.ok) {
    return { ok: false, rateLimited: mr.rateLimited, retryAfter: mr.retryAfter };
  }

  const pipeline = resolvePipeline(projectEncoded, { kind: "mr", iid }, "merge-request", run);
  if (!pipeline.ok) {
    return { ok: false, rateLimited: pipeline.rateLimited, retryAfter: pipeline.retryAfter };
  }

  return {
    ok: true,
    probe: {
      // The MR head sha, not the pipeline sha: a merged-results pipeline reports
      // the ephemeral merge commit, and this sha keys event dedup.
      sha: mr.metadata.sha,
      state: pipeline.state,
      runId: pipeline.runId,
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

function fetchPipelineById(
  projectEncoded: string,
  pipelineId: string,
  run: ExecFn = exec,
): PipelineByIdResult {
  const filter = "{id, status, sha}";
  const result = run(
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
    const pipeline = parsePipeline(JSON.parse(result.stdout !== "" ? result.stdout : "null"));
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
  } catch (error) {
    console.error(
      `glab api returned unparseable JSON for pipeline ${pipelineId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, rateLimited: false, retryAfter: "", notFound: false };
  }
}

type ProbedById =
  | { ok: true; probe: Probe }
  | { ok: false; rateLimited: boolean; retryAfter: string; notFound: boolean };

export function probePipelineId(
  projectEncoded: string,
  pipelineId: string,
  run: ExecFn = exec,
): ProbedById {
  const pipeline = fetchPipelineById(projectEncoded, pipelineId, run);
  if (!pipeline.ok) {
    return {
      ok: false,
      rateLimited: pipeline.rateLimited,
      retryAfter: pipeline.retryAfter,
      notFound: pipeline.notFound,
    };
  }
  const verified = verifyState(projectEncoded, pipeline.pipeline, run);
  if (!verified.ok) {
    return { ok: false, rateLimited: false, retryAfter: "", notFound: false };
  }
  return {
    ok: true,
    probe: {
      sha: pipeline.pipeline.sha,
      state: verified.state,
      runId: pipeline.pipeline.id,
      hasConflicts: false,
      mergeStatus: "",
      detailedMergeStatus: "",
      mrState: "opened",
    },
  };
}

export function probeBranch(projectEncoded: string, branch: string, run: ExecFn = exec): Probed {
  const pipeline = resolvePipeline(projectEncoded, { kind: "branch", branch }, "branch", run);
  if (!pipeline.ok) {
    return { ok: false, rateLimited: pipeline.rateLimited, retryAfter: pipeline.retryAfter };
  }
  return {
    ok: true,
    probe: {
      sha: pipeline.sha,
      state: pipeline.state,
      runId: pipeline.runId,
      hasConflicts: false,
      mergeStatus: "",
      detailedMergeStatus: "",
      mrState: "opened",
    },
  };
}

function fetchInterval(projectEncoded: string, target: PipelineTarget): number {
  const filter =
    '[.[] | select(.source != "external" and .source != "parent_pipeline") | {status, created_at, updated_at}]';
  const label = describeTarget(target);
  const result = exec(
    `glab api '${pipelineListPath(projectEncoded, target, 20)}' | jq -c '${filter}'`,
  );
  if (!result.ok) {
    console.error(
      `glab api failed while computing poll interval for ${label}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${result.stderr.trim()}`,
    );
    return DEFAULT_INTERVAL_SECONDS;
  }
  try {
    const parsed = Entries.safeParse(JSON.parse(result.stdout !== "" ? result.stdout : "[]"));
    if (parsed.success) {
      return computeInterval(pipelineDurations(parsed.data));
    }
    console.error(
      `glab api returned non-array JSON while computing poll interval for ${label}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s`,
    );
  } catch (error) {
    console.error(
      `glab api returned unparseable JSON while computing poll interval for ${label}; defaulting to ${DEFAULT_INTERVAL_SECONDS}s: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return DEFAULT_INTERVAL_SECONDS;
}

function detectProjectFromRemote(): string | null {
  const result = exec("git remote get-url origin");
  if (!result.ok || result.stdout === "") return null;
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

interface RunOptions {
  target: RunTarget;
  intervalSeconds: number | null;
  maxMinutes: number;
  queuedTimeoutMinutes: number;
  apiErrorThreshold: number;
}

type ProbeOutcome =
  | { ok: true; probe: Probe }
  | { ok: false; rateLimited: boolean; retryAfter: string; notFound: boolean };

function isTerminal(events: Event[], mode: RunTarget["mode"]): boolean {
  return events.some(
    (e) =>
      e.type === "pr-closed" ||
      e.type === "merged" ||
      (e.type === "status" && e.state === "success") ||
      (mode === "pipeline-id" && e.type === "status" && e.state === "failing"),
  );
}

async function watch(options: RunOptions): Promise<void> {
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

  const doProbe = (): ProbeOutcome => {
    if (target.mode === "mr" && iid !== null) {
      const r = probeMr(projectEncoded, iid);
      if (!r.ok) {
        return { ok: false, rateLimited: r.rateLimited, retryAfter: r.retryAfter, notFound: false };
      }
      return { ok: true, probe: r.probe };
    }
    if (target.mode === "branch") {
      const r = probeBranch(projectEncoded, target.branch);
      if (!r.ok) {
        return { ok: false, rateLimited: r.rateLimited, retryAfter: r.retryAfter, notFound: false };
      }
      return { ok: true, probe: r.probe };
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
      return { ok: true, probe: r.probe };
    }
    throw new Error("Invalid watcher target state");
  };

  const intervalTarget: PipelineTarget | null =
    target.mode === "mr" && iid !== null
      ? { kind: "mr", iid }
      : target.mode === "branch"
        ? { kind: "branch", branch: target.branch }
        : null;

  let state = initialState();
  let intervalSeconds: number | null = options.intervalSeconds;
  const deadline = Date.now() + options.maxMinutes * 60 * 1000;

  while (true) {
    const now = Date.now();
    if (now >= deadline) {
      emit({ type: "max-time-reached", minutes: options.maxMinutes });
      return;
    }

    const result = doProbe();
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
      // Settle merge status before deriving events so `conflicts` lands in the
      // same cycle as a stale `success`, ahead of the terminal return below.
      let probe = result.probe;
      if (target.mode === "mr" && iid !== null && probeIsUndetermined(probe)) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: each cycle reads state the previous cycle left behind.
        const resolved = await resolveMergeStatus(projectEncoded, iid, exec, Bun.sleep);
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

      intervalSeconds ??= intervalTarget
        ? fetchInterval(projectEncoded, intervalTarget)
        : DEFAULT_INTERVAL_SECONDS;
    }

    // oxlint-disable-next-line no-await-in-loop -- poll interval between API cycles.
    await Bun.sleep((intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000);
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
  if (mrUrl != null && mrUrl !== "") {
    target = { mode: "mr", mrUrl };
  } else if (branch != null && branch !== "") {
    const project = argv.flags.project ?? detectProjectFromRemote();
    if (project == null || project === "") {
      console.error("Could not infer project from git remote. Pass --project <group/project>.");
      process.exit(1);
    }
    target = { mode: "branch", project, branch };
  } else if (pipelineId != null && pipelineId !== "") {
    const project = argv.flags.project ?? detectProjectFromRemote();
    if (project == null || project === "") {
      console.error("Could not infer project from git remote. Pass --project <group/project>.");
      process.exit(1);
    }
    target = { mode: "pipeline-id", project, pipelineId };
  } else {
    // Unreachable: the XOR check above guarantees one flag is set.
    throw new Error("No target specified");
  }

  await watch({
    target,
    intervalSeconds: argv.flags.interval ?? null,
    maxMinutes: argv.flags.maxMinutes,
    queuedTimeoutMinutes: argv.flags.queuedTimeout,
    apiErrorThreshold: argv.flags.apiErrorThreshold,
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
