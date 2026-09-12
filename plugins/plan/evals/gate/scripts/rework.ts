#!/usr/bin/env bun
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { cli } from "cleye";
import { decodeJson } from "../../../../../packages/decode/index";
import { ARMS, armReason } from "./arms";
import { caseId, type Present, Presents } from "./decisions";
import {
  type CaseResult,
  lineAccounting,
  nearLimit,
  overLimit,
  transcriptMetrics,
} from "./metrics";

// Replay a size deny: hand a headless session the denied plan and one arm's deny
// reason, let it rework the file, and record what it did. Sessions run bare
// (no settings, hooks, or plugins) with the planning guidelines appended to the
// system prompt, matching what the plan-mode injection delivers.

const ROOT = join(import.meta.dirname, "..");
const GUIDELINES = join(ROOT, "..", "..", "references", "guidelines.md");
const DEFAULT_MODEL = "claude-opus-5";
const TOOLS = "Read,Write,Edit,Bash,Glob,Grep";

export interface Job {
  arm: string;
  present: Present;
}

// Egress rule: the mined file holds work-host plans too. Only local plans are
// handed to a model, and only ones the size rule denied.
export function selectCases(presents: readonly Present[]): Present[] {
  return presents.filter((p) => p.host === "local" && p.actual === "gate:size");
}

export function planFileName(present: Present): string {
  const name = present.plan_file === null ? "" : basename(present.plan_file);
  return name.endsWith(".md") ? name : `${caseId(present)}.md`;
}

export function prompt(planPath: string, reason: string): string {
  return [
    `You are in a plan-mode session. The plan is at \`${planPath}\`. The research behind it is finished, and everything known about the task is in that file.`,
    "You presented the plan with ExitPlanMode and the presentation was denied with this reason:",
    "",
    reason,
    "",
    "Rework the plan file so it can be presented again. Write any supporting files next to it. Reply with the single word DONE when the plan file is ready to present.",
  ].join("\n");
}

export function command(
  model: string,
  maxTurns: number,
  guidelines: string,
  task: string,
): string[] {
  return [
    "claude",
    "-p",
    "--setting-sources",
    "",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(maxTurns),
    "--dangerously-skip-permissions",
    "--tools",
    TOOLS,
    "--append-system-prompt",
    guidelines,
    task,
  ];
}

interface RunOptions {
  run: string;
  model: string;
  maxTurns: number;
  guidelines: string;
  dryRun: boolean;
}

async function sidecarsIn(
  dir: string,
  planFile: string,
): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md") && name !== planFile);
  return Promise.all(
    names.map(async (name) => ({ name, text: await Bun.file(join(dir, name)).text() })),
  );
}

async function runJob(job: Job, options: RunOptions): Promise<CaseResult | null> {
  const id = caseId(job.present);
  const resultsDir = join(ROOT, "results", options.run, job.arm);
  const resultPath = join(resultsDir, `${id}.json`);
  if (await Bun.file(resultPath).exists()) {
    console.log(`[${job.arm}] ${id} cached`);
    return decodeJson(CaseResult, await Bun.file(resultPath).text(), resultPath);
  }

  const dir = join(ROOT, "workdir", options.run, job.arm, id);
  const plansDir = join(dir, "plans");
  await rm(dir, { recursive: true, force: true });
  await mkdir(plansDir, { recursive: true });
  const planFile = planFileName(job.present);
  await Bun.write(join(plansDir, planFile), job.present.plan);

  const reason = armReason(job.arm, job.present.plan);
  const argv = command(
    options.model,
    options.maxTurns,
    options.guidelines,
    prompt(`plans/${planFile}`, reason),
  );
  if (options.dryRun) {
    console.log(`[${job.arm}] ${id} (${job.present.chars} chars) in ${dir}`);
    console.log(`  ${reason}`);
    return null;
  }

  const proc = Bun.spawn(argv, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  await mkdir(resultsDir, { recursive: true });
  await Bun.write(join(resultsDir, `${id}.jsonl`), stdout);
  if (stderr.trim() !== "") await Bun.write(join(resultsDir, `${id}.stderr`), stderr);

  const transcript = transcriptMetrics(stdout.split("\n"));
  const planPath = join(plansDir, planFile);
  const after = (await Bun.file(planPath).exists()) ? await Bun.file(planPath).text() : null;
  const sidecars = await sidecarsIn(plansDir, planFile);
  const result: CaseResult = {
    id,
    arm: job.arm,
    model: options.model,
    chars_before: job.present.chars,
    chars_after: after === null ? null : after.length,
    over_limit: after !== null && overLimit(after.length),
    near_limit: after !== null && nearLimit(after.length),
    sidecars: sidecars.map((s) => ({ name: s.name, chars: s.text.length })),
    lines: lineAccounting(
      job.present.plan,
      after ?? "",
      sidecars.map((s) => s.text),
    ),
    transcript,
    exit_code: exitCode,
  };
  await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `[${job.arm}] ${id} tokens=${transcript.output_tokens} turns=${transcript.turns} wc=${transcript.wc_calls} edits=${transcript.edits} chars=${result.chars_before}->${result.chars_after ?? "missing"} sidecars=${sidecars.length} deleted=${result.lines.deleted}/${result.lines.before}${transcript.done ? "" : " (no DONE)"}`,
  );
  return result;
}

async function drain(queue: Job[], options: RunOptions, results: CaseResult[]): Promise<void> {
  const job = queue.shift();
  if (job === undefined) return;
  const result = await runJob(job, options);
  if (result !== null) results.push(result);
  return drain(queue, options, results);
}

export async function runAll(
  jobs: Job[],
  options: RunOptions,
  concurrency: number,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: concurrency }, () => drain(queue, options, results)));
  return results;
}

function defaultRunLabel(): string {
  return new Date().toISOString().slice(0, 16).replaceAll(/[-:]/g, "").replace("T", "-");
}

if (import.meta.main) {
  const argv = cli({
    name: "rework",
    help: { description: "Replay size denies through headless sessions, one per arm." },
    flags: {
      presents: {
        type: String,
        default: join(ROOT, "data", "presents.json"),
        description: "Mined presentations",
      },
      arm: {
        type: [String],
        description: `Arms to run (default: ${Object.keys(ARMS).join(", ")})`,
      },
      case: { type: [String], description: "Only these case ids" },
      limit: { type: Number, description: "Only the first N cases" },
      model: { type: String, default: DEFAULT_MODEL, description: "Model for the sessions" },
      run: { type: String, description: "Run label under results/ (default: timestamp)" },
      concurrency: { type: Number, default: 4, description: "Sessions in flight" },
      maxTurns: { type: Number, default: 80, description: "Turn cap per session" },
      dryRun: { type: Boolean, description: "Print the jobs without spawning sessions" },
    },
  });

  const presents = decodeJson(
    Presents,
    await Bun.file(argv.flags.presents).text(),
    argv.flags.presents,
  );
  let cases = selectCases(presents);
  if (argv.flags.case.length > 0) cases = cases.filter((p) => argv.flags.case.includes(caseId(p)));
  if (argv.flags.limit !== undefined) cases = cases.slice(0, argv.flags.limit);
  const arms = argv.flags.arm.length > 0 ? argv.flags.arm : Object.keys(ARMS);
  const jobs = arms.flatMap((arm) => cases.map((present) => ({ arm, present })));

  const options: RunOptions = {
    run: argv.flags.run ?? defaultRunLabel(),
    model: argv.flags.model,
    maxTurns: argv.flags.maxTurns,
    guidelines: await Bun.file(GUIDELINES).text(),
    dryRun: argv.flags.dryRun ?? false,
  };
  console.log(
    `run ${options.run}: ${cases.length} cases x ${arms.length} arms on ${options.model}`,
  );
  const results = await runAll(jobs, options, argv.flags.concurrency);
  if (!options.dryRun) {
    const tokens = results.reduce((sum, r) => sum + r.transcript.output_tokens, 0);
    console.log(`${results.length} sessions, ${tokens} output tokens -> results/${options.run}`);
  }
}
