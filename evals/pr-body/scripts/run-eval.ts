#!/usr/bin/env bun
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { cli } from "cleye";
import { z } from "zod";
import { decodeFile, decodeJson, decodeJsonLines } from "../../../packages/decode/index";
import { scoreBody } from "./score";

// A/B runner for `pull-request:create` guidance. Each arm is a markdown file
// holding the guidance text under test; the harness cannot load the skill, so
// the text is inlined into the generation prompt. Every (scenario, arm, seed)
// triple produces one body, which the deterministic scorer then grades. The
// blinded LLM judge (judge.ts) reads the rows this writes.

const GEN_MODEL = "claude-opus-5";

// claude-opus-5: $5/M input, $25/M output.
const GEN_RATES: TokenRates = { input: 5 / 1_000_000, output: 25 / 1_000_000 };

// The SDK's own retry budget covers 429s, 5xx, and connection failures with
// exponential backoff, honoring retry-after when the API sends it.
const MAX_RETRIES = 3;

export const ARMS = ["a", "b"] as const;
export const Arm = z.enum(ARMS);
export type Arm = z.infer<typeof Arm>;

export const Scenario = z.looseObject({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  repo: z.string(),
  tier: z.literal("personal"),
  diffSummary: z.string(),
  substance: z.array(z.string()),
  originalBody: z.string(),
});
export type Scenario = z.infer<typeof Scenario>;

export type ScoreRow = ReturnType<typeof scoreBody>;

export const Usage = z.object({
  input: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  output: z.number(),
});
export type Usage = z.infer<typeof Usage>;

/** `score` is written but never read back, so it rides along unmodeled. */
export const GenerationRow = z.looseObject({
  scenarioId: z.string(),
  /** "original" rows carry the shipped body as a baseline; no model produced them. */
  arm: z.enum([...ARMS, "original"]),
  seed: z.number(),
  model: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  usage: Usage,
});
export type GenerationRow = z.infer<typeof GenerationRow>;

/** USD per token. Cache writes and reads bill as multiples of the input rate. */
export interface TokenRates {
  input: number;
  output: number;
}

const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function emptyUsage(): Usage {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}

export function toUsage(usage: Anthropic.Usage): Usage {
  return {
    input: usage.input_tokens,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens,
  };
}

export function addUsage(total: Usage, row: Usage): void {
  total.input += row.input;
  total.cacheWrite += row.cacheWrite;
  total.cacheRead += row.cacheRead;
  total.output += row.output;
}

export function costUsd(usage: Usage, rates: TokenRates): number {
  return (
    usage.input * rates.input +
    usage.cacheWrite * CACHE_WRITE_MULTIPLIER * rates.input +
    usage.cacheRead * CACHE_READ_MULTIPLIER * rates.input +
    usage.output * rates.output
  );
}

export function formatUsage(usage: Usage): string {
  return [
    `${usage.input} input`,
    `${usage.cacheWrite} cache write`,
    `${usage.cacheRead} cache read`,
    `${usage.output} output`,
  ].join(" + ");
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  model: string;
  seeds: number;
  scenarioIds: string[];
  armFiles: Record<Arm, string>;
  usage: Usage;
  costUsd: number;
}

export function generationsPath(runDir: string): string {
  return join(runDir, "generations.jsonl");
}

export function manifestPath(runDir: string): string {
  return join(runDir, "run.json");
}

export async function loadScenarios(dir: string): Promise<Scenario[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).toSorted();
  const scenarios: Scenario[] = [];
  for (const name of names) {
    scenarios.push(await decodeFile(Scenario, join(dir, name)));
  }
  if (scenarios.length === 0) throw new Error(`No scenario JSON files in ${dir}`);
  return scenarios;
}

export async function readGenerations(runDir: string): Promise<GenerationRow[]> {
  const path = generationsPath(runDir);
  return decodeJsonLines(GenerationRow, await Bun.file(path).text(), path);
}

const Draft = z.looseObject({ title: z.string(), body: z.string() });

/** JSON schema the generation call is constrained to. */
export function draftSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title", "body"],
    additionalProperties: false,
  };
}

export function systemPrompt(guidance: string): string {
  return [
    "You are the author of a change to your own repository, opening the pull request for it.",
    "",
    "The text between the guidance tags is the standing house style for pull request descriptions in this repository.",
    "",
    "<guidance>",
    guidance.trim(),
    "</guidance>",
    "",
    "Write the title and the body you would ship for the change described in the next message.",
    "The body is GitHub-flavored markdown, returned raw rather than inside a code fence.",
    "Return the JSON object the response schema requires.",
  ].join("\n");
}

export function userPrompt(scenario: Scenario, seed: number): string {
  const substance =
    scenario.substance.length > 0
      ? scenario.substance.map((s) => `- ${s}`).join("\n")
      : "(none recorded)";
  return [
    `Repository: ${scenario.repo}`,
    `Audience tier: ${scenario.tier}`,
    "",
    "What changed:",
    scenario.diffSummary.trim(),
    "",
    "Material from the session that produced the change. Decisions, evidence, rejected",
    "alternatives, and deferred work, in no particular order. Use what serves a reviewer.",
    substance,
    "",
    `Draft seed: ${seed}. Two authors drafting the same description land in different places; this number identifies which draft this is.`,
  ].join("\n");
}

interface Draft {
  title: string;
  body: string;
  usage: Usage;
}

async function generate(
  client: Anthropic,
  system: string,
  scenario: Scenario,
  seed: number,
  model: string,
): Promise<Draft> {
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: draftSchema() } },
    messages: [{ role: "user", content: userPrompt(scenario, seed) }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (block?.type !== "text") {
    throw new Error(`${scenario.id} seed ${seed}: no text block (stop: ${response.stop_reason})`);
  }
  const draft = decodeJson(Draft, block.text, `${scenario.id} seed ${seed} draft`);
  return {
    title: draft.title,
    body: draft.body,
    usage: toUsage(response.usage),
  };
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        const item = items[index];
        if (index >= items.length || item === undefined) return;
        results[index] = await fn(item);
      }
    }),
  );
  return results;
}

export function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. The runner only works with live credentials.");
  }
}

interface Job {
  scenario: Scenario;
  arm: Arm;
  seed: number;
}

function buildJobs(scenarios: Scenario[], seeds: number): Job[] {
  const jobs: Job[] = [];
  for (const scenario of scenarios) {
    for (const arm of ARMS) {
      for (let seed = 1; seed <= seeds; seed++) {
        jobs.push({ scenario, arm, seed });
      }
    }
  }
  return jobs;
}

function rowKey(scenarioId: string, arm: Arm | "original", seed: number): string {
  return `${scenarioId}::${arm}::${seed}`;
}

/** Rows a previous invocation of the same --run-id already paid for. */
async function readRecorded(runDir: string): Promise<GenerationRow[]> {
  return (await Bun.file(generationsPath(runDir)).exists()) ? await readGenerations(runDir) : [];
}

function defaultRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

async function main(): Promise<void> {
  const dir = join(import.meta.dirname, "..");
  const argv = cli({
    name: "run-eval",
    help: {
      description:
        "Generate PR bodies for every (scenario, arm, seed) triple, score them, and write the run.",
    },
    flags: {
      scenarios: {
        type: String,
        default: join(dir, "scenarios"),
        description: "Directory of scenario JSON files",
      },
      armA: { type: String, description: "Markdown file holding arm A's guidance text" },
      armB: { type: String, description: "Markdown file holding arm B's guidance text" },
      seeds: { type: Number, default: 2, description: "Drafts per scenario per arm" },
      out: { type: String, default: join(dir, "results"), description: "Results base directory" },
      runId: { type: String, description: "Run directory name (default: UTC timestamp)" },
      concurrency: { type: Number, default: 5, description: "API calls in flight" },
      model: { type: String, default: GEN_MODEL, description: "Generation model" },
      scenario: {
        type: [String],
        description: "Restrict the run to these scenario ids (repeatable)",
      },
      skipBaseline: {
        type: Boolean,
        default: false,
        description: "Skip scoring each scenario's shipped body as a baseline row",
      },
    },
  });

  const { armA, armB } = argv.flags;
  if (!armA || !armB) {
    console.error("Both --arm-a and --arm-b are required.\n");
    argv.showHelp();
    process.exit(1);
  }
  requireApiKey();

  const all = await loadScenarios(argv.flags.scenarios);
  const wanted = new Set(argv.flags.scenario);
  const scenarios = wanted.size > 0 ? all.filter((s) => wanted.has(s.id)) : all;
  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched: ${[...wanted].join(", ")}`);
  }

  const guidance: Record<Arm, string> = {
    a: await Bun.file(armA).text(),
    b: await Bun.file(armB).text(),
  };
  const systems: Record<Arm, string> = {
    a: systemPrompt(guidance.a),
    b: systemPrompt(guidance.b),
  };

  const runId = argv.flags.runId ?? defaultRunId();
  const runDir = join(argv.flags.out, runId);
  await mkdir(runDir, { recursive: true });
  await Bun.write(join(runDir, "arm-a.md"), guidance.a);
  await Bun.write(join(runDir, "arm-b.md"), guidance.b);

  const recorded = await readRecorded(runDir);
  const done = new Set(recorded.map((row) => rowKey(row.scenarioId, row.arm, row.seed)));

  // The sink truncates on open, so the rows carried over are written back first.
  const writer = Bun.file(generationsPath(runDir)).writer();
  const total = emptyUsage();
  const emit = async (row: GenerationRow): Promise<void> => {
    await writer.write(`${JSON.stringify(row)}\n`);
    await writer.flush();
  };

  for (const row of recorded) {
    addUsage(total, row.usage);
    await emit(row);
  }
  if (recorded.length > 0) {
    console.error(`resuming ${runId}: ${recorded.length} rows already recorded`);
  }

  if (!argv.flags.skipBaseline) {
    for (const scenario of scenarios) {
      if (done.has(rowKey(scenario.id, "original", 0))) continue;
      await emit({
        scenarioId: scenario.id,
        arm: "original",
        seed: 0,
        model: null,
        title: scenario.title,
        body: scenario.originalBody,
        score: scoreBody(scenario.originalBody, scenario.title),
        usage: emptyUsage(),
      });
    }
  }

  const client = new Anthropic({ maxRetries: MAX_RETRIES });
  const planned = buildJobs(scenarios, argv.flags.seeds);
  const jobs = planned.filter((job) => !done.has(rowKey(job.scenario.id, job.arm, job.seed)));
  if (jobs.length < planned.length) {
    console.error(`skipping ${planned.length - jobs.length} generations already on disk`);
  }
  let generated = 0;

  await mapPool(jobs, argv.flags.concurrency, async (job) => {
    const draft = await generate(
      client,
      systems[job.arm],
      job.scenario,
      job.seed,
      argv.flags.model,
    );
    addUsage(total, draft.usage);
    await emit({
      scenarioId: job.scenario.id,
      arm: job.arm,
      seed: job.seed,
      model: argv.flags.model,
      title: draft.title,
      body: draft.body,
      score: scoreBody(draft.body, draft.title),
      usage: draft.usage,
    });
    generated++;
    console.error(
      `[${generated}/${jobs.length}] ${job.scenario.id} arm ${job.arm} seed ${job.seed}`,
    );
  });

  await writer.end();

  const cost = costUsd(total, GEN_RATES);
  const manifest: RunManifest = {
    runId,
    createdAt: new Date().toISOString(),
    model: argv.flags.model,
    seeds: argv.flags.seeds,
    scenarioIds: scenarios.map((s) => s.id),
    armFiles: { a: basename(armA), b: basename(armB) },
    usage: total,
    costUsd: cost,
  };
  await Bun.write(manifestPath(runDir), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(runDir);
  console.error(
    `${generated} new generations (${planned.length} total), ${formatUsage(total)} tokens, $${cost.toFixed(4)}`,
  );
}

if (import.meta.main) {
  await main();
}
