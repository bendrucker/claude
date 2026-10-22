#!/usr/bin/env bun

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { timeHook } from "./hook-metrics";

// `gh workflow run` returns as soon as GitHub accepts the dispatch, so a job
// waiting on a busy self-hosted runner looks the same as one about to start.
// After a dispatch, this reports the new run's place in line for its runner
// labels and which jobs hold those runners.

const HOOK = "github-runner-queue";
const RUN_URL = /https:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/(\d+)/;
const JOB_ATTEMPTS = 5;
const JOB_RETRY_MS = 1500;
// The runs list includes runs stuck queued for months with no jobs. A
// day bounds the scan to anything that could plausibly hold a runner.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const ACTIVE = ["in_progress", "queued", "pending"] as const;

const Input = z.looseObject({
  session_id: z.string().optional().catch(undefined),
  hook_event_name: z.string().optional().catch(undefined),
  tool_name: z.string().optional().catch(undefined),
  tool_input: z.looseObject({ command: z.string().catch("") }).catch({ command: "" }),
  tool_response: z
    .looseObject({ stdout: z.string().catch(""), stderr: z.string().catch("") })
    .catch({ stdout: "", stderr: "" }),
});
type Input = z.infer<typeof Input>;

const Job = z.looseObject({
  id: z.number(),
  run_id: z.number(),
  name: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  created_at: z.string(),
  started_at: z.string().nullable().catch(null),
  head_branch: z.string().nullable().catch(null),
});
export type Job = z.infer<typeof Job>;

const Run = z.looseObject({
  id: z.number(),
  name: z.string().nullable().catch(null),
  status: z.string().nullable().catch(null),
  workflow_id: z.number(),
  created_at: z.string(),
  run_started_at: z.string().nullable().catch(null),
  updated_at: z.string(),
});
export type Run = z.infer<typeof Run>;

const Jobs = z.looseObject({ jobs: z.array(Job) });
const Runs = z.looseObject({ workflow_runs: z.array(Run) });

export interface RunRef {
  host: string;
  repo: string;
  id: number;
}

/** Fetches one REST path and returns the response body. */
export type Api = (path: string) => Promise<string>;

export function invokesWorkflowRun(command: string): boolean {
  return /(^|[\s;&|(])gh\s+(?:-\S+\s+\S+\s+)*workflow\s+run\b/.test(command);
}

export function parseRunUrl(output: string): RunRef | null {
  const match = RUN_URL.exec(output);
  if (!match) return null;
  const [, host = "", owner = "", name = "", id = ""] = match;
  return { host, repo: `${owner}/${name}`, id: Number(id) };
}

export function ghApi(host: string): Api {
  const hostArgs = host === "github.com" ? [] : ["--hostname", host];
  return async (path) => {
    const proc = Bun.spawn(["gh", "api", ...hostArgs, path], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`gh api ${path} exited ${code}`);
    return out;
  };
}

async function get<T>(api: Api, path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await api(path)));
}

async function runJobs(api: Api, repo: string, id: number): Promise<Job[]> {
  const path = `repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`;
  return (await get(api, path, Jobs)).jobs;
}

// A dispatched run creates its jobs a second or two after the run itself.
async function awaitJobs(api: Api, ref: RunRef, retryMs: number, attempt = 1): Promise<Job[]> {
  const jobs = await runJobs(api, ref.repo, ref.id);
  if (jobs.length > 0 || attempt >= JOB_ATTEMPTS) return jobs;
  await Bun.sleep(retryMs);
  return awaitJobs(api, ref, retryMs, attempt + 1);
}

const covers = (job: Job, labels: string[]) => labels.every((label) => job.labels.includes(label));

const minutesSince = (iso: string, now: number) =>
  Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));

/** Median wall time of a workflow's recent successful runs, in minutes. */
async function typicalMinutes(api: Api, repo: string, workflow: number): Promise<number | null> {
  const path = `repos/${repo}/actions/workflows/${workflow}/runs?status=success&per_page=5`;
  const { workflow_runs } = await get(api, path, Runs);
  const minutes = workflow_runs
    .filter((run) => run.run_started_at !== null)
    .map((run) => (Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? "")) / 60_000)
    .toSorted((a, b) => a - b);
  if (minutes.length === 0) return null;
  return Math.round(minutes[Math.floor(minutes.length / 2)] ?? 0);
}

interface Target {
  labels: string[];
  created_at: string;
  /** The run waits on its concurrency group, which the API does not name. */
  pending: boolean;
}

// A run held by its concurrency group stays `pending` with no jobs, so its
// runner labels are unknown and every self-hosted job counts.
async function targetOf(api: Api, ref: RunRef, retryMs: number): Promise<Target | null> {
  const jobs = await awaitJobs(api, ref, retryMs);
  const job = jobs.find((j) => j.status === "queued" && j.labels.includes("self-hosted"));
  if (job) return { labels: job.labels, created_at: job.created_at, pending: false };
  if (jobs.length > 0) return null;
  const run = await get(api, `repos/${ref.repo}/actions/runs/${ref.id}`, Run);
  if (run.status !== "pending") return null;
  return { labels: ["self-hosted"], created_at: run.created_at, pending: true };
}

export interface Queue extends Target {
  run: number;
  holding: { job: Job; run: Run; typical: number | null }[];
  ahead: { job: Job; run: Run }[];
}

export async function queueFor(
  api: Api,
  ref: RunRef,
  now = Date.now(),
  retryMs = JOB_RETRY_MS,
): Promise<Queue | null> {
  const target = await targetOf(api, ref, retryMs);
  if (!target) return null;

  const since = new Date(now - LOOKBACK_MS).toISOString();
  const lists = await Promise.all(
    ACTIVE.map(async (status) =>
      get(
        api,
        `repos/${ref.repo}/actions/runs?status=${status}&created=>=${since}&per_page=100`,
        Runs,
      ),
    ),
  );
  const others = lists.flatMap((list) => list.workflow_runs).filter((run) => run.id !== ref.id);
  const jobs = await Promise.all(
    others.map(async (run) => (await runJobs(api, ref.repo, run.id)).map((job) => ({ job, run }))),
  );
  const matching = jobs.flat().filter(({ job }) => covers(job, target.labels));

  const holding = await Promise.all(
    matching
      .filter(({ job }) => job.status === "in_progress")
      .map(async ({ job, run }) => ({
        job,
        run,
        typical: await typicalMinutes(api, ref.repo, run.workflow_id).catch(() => null),
      })),
  );
  const ahead = matching
    .filter(({ job }) => job.status === "queued" && job.created_at < target.created_at)
    .toSorted((a, b) => a.job.created_at.localeCompare(b.job.created_at));
  return { run: ref.id, ...target, holding, ahead };
}

function describe(job: Job, run: Run): string {
  const branch = job.head_branch === null ? "" : ` on ${job.head_branch}`;
  return `${run.name ?? "run"} run ${run.id} job "${job.name}"${branch}`;
}

export function formatQueue(queue: Queue, now = Date.now()): string {
  const labels = queue.labels.filter((label) => label !== "self-hosted").join(", ");
  const waitsOn = queue.pending
    ? "is pending on its concurrency group, which a self-hosted job below may hold"
    : `is queued for a self-hosted runner labeled ${labels === "" ? "self-hosted" : labels}`;
  const lines = [
    `[github/runner-queue] Run ${queue.run} ${waitsOn}: ${queue.ahead.length} job(s) ahead, ${queue.holding.length} matching job(s) running.`,
  ];
  if (queue.holding.length > 0) {
    lines.push("Holding the runner:");
    for (const { job, run, typical } of queue.holding) {
      const started =
        job.started_at === null ? "" : `, started ${minutesSince(job.started_at, now)}m ago`;
      const usual = typical === null ? "" : ` (recent successful runs take ~${typical}m)`;
      lines.push(`- ${describe(job, run)}${started}${usual}`);
    }
  }
  if (queue.ahead.length > 0) {
    lines.push("Queued ahead:");
    for (const { job, run } of queue.ahead) {
      lines.push(`- ${describe(job, run)}, queued ${minutesSince(job.created_at, now)}m ago`);
    }
  }
  if (queue.holding.length === 0 && queue.ahead.length === 0) {
    lines.push("Nothing matching holds the runner, so it is starting or offline.");
  }
  return lines.join("\n");
}

export async function processInput(
  input: Input,
  api?: Api,
  now = Date.now(),
  retryMs?: number,
): Promise<SyncHookJSONOutput | null> {
  if (!invokesWorkflowRun(input.tool_input.command)) return null;
  const ref = parseRunUrl(`${input.tool_response.stdout}\n${input.tool_response.stderr}`);
  if (!ref) return null;
  const queue = await queueFor(api ?? ghApi(ref.host), ref, now, retryMs);
  if (!queue) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: formatQueue(queue, now),
    },
  };
}

async function main(): Promise<void> {
  const input = Input.parse(JSON.parse(await Bun.stdin.text()));
  const output = await timeHook(HOOK, input, () => processInput(input));
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(
      `[github/runner-queue] ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
