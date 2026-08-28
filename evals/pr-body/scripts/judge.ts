#!/usr/bin/env bun
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { cli } from "cleye";
import { z } from "zod";
import { decodeJson, decodeJsonLines } from "../../../packages/decode/index";
import {
  Arm,
  ARMS,
  addUsage,
  costUsd,
  emptyUsage,
  formatUsage,
  type GenerationRow,
  loadScenarios,
  mapPool,
  readGenerations,
  requireApiKey,
  type Scenario,
  type TokenRates,
  toUsage,
  Usage,
} from "./run-eval";

// Blinded pairwise judge over a run written by run-eval.ts. Each pair is one
// scenario at one seed, arm A against arm B, presented in randomized order as
// candidates 1 and 2. The judge never sees the arm labels; the slot-to-arm
// mapping is recorded on every row so a verdict can be re-derived or audited.

const JUDGE_MODEL = "claude-sonnet-5";

// claude-sonnet-5: $3/M input, $15/M output at list price.
const JUDGE_RATES: TokenRates = { input: 3 / 1_000_000, output: 15 / 1_000_000 };

// The SDK's own retry budget covers 429s, 5xx, and connection failures with
// exponential backoff, honoring retry-after when the API sends it.
const MAX_RETRIES = 3;

export const AXES = ["narrationLeak", "verbosity", "selfContained", "substanceRetention"] as const;
export type Axis = (typeof AXES)[number];

export const SLOTS = ["1", "2"] as const;
export type Slot = (typeof SLOTS)[number];

const AxisVerdict = z.looseObject({ score: z.number(), justification: z.string().catch("") });
export type AxisVerdict = z.infer<typeof AxisVerdict>;

// Listed per axis so adding an axis is a type error here.
const CandidateVerdict = z.looseObject({
  narrationLeak: AxisVerdict,
  verbosity: AxisVerdict,
  selfContained: AxisVerdict,
  substanceRetention: AxisVerdict,
});
export type CandidateVerdict = z.infer<typeof CandidateVerdict>;

const Verdict = z.looseObject({
  candidates: z.looseObject({ "1": CandidateVerdict, "2": CandidateVerdict }),
  preference: z.enum([...SLOTS, "tie"]),
  preferenceReason: z.string().catch(""),
});
export type Verdict = z.infer<typeof Verdict>;

const JudgmentRow = z.looseObject({
  scenarioId: z.string(),
  seed: z.number(),
  model: z.string(),
  /** Which arm sat in each blinded slot. */
  mapping: z.looseObject({ "1": Arm, "2": Arm }),
  arms: z.looseObject({ a: CandidateVerdict, b: CandidateVerdict }),
  preference: z.enum([...ARMS, "tie"]),
  preferenceReason: z.string(),
  usage: Usage,
});
export type JudgmentRow = z.infer<typeof JudgmentRow>;

export interface Pair {
  scenario: Scenario;
  seed: number;
  rows: Record<Arm, GenerationRow>;
}

export function judgmentsPath(runDir: string): string {
  return join(runDir, "judgments.jsonl");
}

// Scenario ids match NNN-name-number, so a colon pair cannot occur inside one.
const PAIR_KEY_SEPARATOR = "::";

function pairKey(scenarioId: string, seed: number): string {
  return `${scenarioId}${PAIR_KEY_SEPARATOR}${seed}`;
}

export function buildPairs(scenarios: Scenario[], rows: GenerationRow[]): Pair[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const grouped = new Map<string, Partial<Record<Arm, GenerationRow>>>();
  for (const row of rows) {
    if (row.arm !== "a" && row.arm !== "b") continue;
    const key = pairKey(row.scenarioId, row.seed);
    const entry = grouped.get(key) ?? {};
    entry[row.arm] = row;
    grouped.set(key, entry);
  }

  const pairs: Pair[] = [];
  for (const [key, entry] of grouped) {
    const [scenarioId = "", rawSeed = ""] = key.split(PAIR_KEY_SEPARATOR);
    const scenario = byId.get(scenarioId);
    if (!scenario) {
      console.error(`skip: no scenario file for ${scenarioId}`);
      continue;
    }
    if (!entry.a || !entry.b) {
      console.error(`skip: ${scenarioId} seed ${rawSeed} has only one arm`);
      continue;
    }
    pairs.push({ scenario, seed: Number(rawSeed), rows: { a: entry.a, b: entry.b } });
  }
  return pairs.toSorted((x, y) => {
    const byScenario = x.scenario.id.localeCompare(y.scenario.id);
    return byScenario !== 0 ? byScenario : x.seed - y.seed;
  });
}

/** Randomizes which arm occupies which slot, so the judge cannot infer the arm from position. */
export function blind(flip: boolean): Record<Slot, Arm> {
  return flip ? { "1": "b", "2": "a" } : { "1": "a", "2": "b" };
}

export function renderPair(pair: Pair, mapping: Record<Slot, Arm>): string {
  const substance =
    pair.scenario.substance.length > 0
      ? pair.scenario.substance.map((s) => `- ${s}`).join("\n")
      : "(none recorded)";
  const lines = [
    `Repository: ${pair.scenario.repo}`,
    "",
    "Change:",
    pair.scenario.diffSummary.trim(),
    "",
    "Substance:",
    substance,
  ];
  for (const slot of SLOTS) {
    const row = pair.rows[mapping[slot]];
    lines.push("", `## Candidate ${slot}`, "", `Title: ${row.title}`, "", "Body:", row.body.trim());
  }
  return lines.join("\n");
}

function axisSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      score: { type: "integer", enum: [1, 2, 3, 4, 5] },
      justification: { type: "string" },
    },
    required: ["score", "justification"],
    additionalProperties: false,
  };
}

function candidateSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(AXES.map((axis) => [axis, axisSchema()])),
    required: [...AXES],
    additionalProperties: false,
  };
}

export function verdictSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      candidates: {
        type: "object",
        properties: Object.fromEntries(SLOTS.map((slot) => [slot, candidateSchema()])),
        required: [...SLOTS],
        additionalProperties: false,
      },
      preference: { type: "string", enum: [...SLOTS, "tie"] },
      preferenceReason: { type: "string" },
    },
    required: ["candidates", "preference", "preferenceReason"],
    additionalProperties: false,
  };
}

export function parseVerdict(jsonText: string): Verdict {
  return decodeJson(Verdict, jsonText, "judge verdict");
}

export function deblind(
  verdict: Verdict,
  mapping: Record<Slot, Arm>,
): {
  arms: Record<Arm, CandidateVerdict>;
  preference: Arm | "tie";
} {
  const [first, second] = [verdict.candidates["1"], verdict.candidates["2"]];
  return {
    arms: mapping["1"] === "a" ? { a: first, b: second } : { a: second, b: first },
    preference: verdict.preference === "tie" ? "tie" : mapping[verdict.preference],
  };
}

async function judgePair(
  client: Anthropic,
  pair: Pair,
  mapping: Record<Slot, Arm>,
  prompt: string,
  model: string,
): Promise<JudgmentRow> {
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: verdictSchema() } },
    messages: [{ role: "user", content: renderPair(pair, mapping) }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (block?.type !== "text") {
    throw new Error(
      `${pair.scenario.id} seed ${pair.seed}: judge returned no text block (stop: ${response.stop_reason})`,
    );
  }
  const verdict = parseVerdict(block.text);
  const { arms, preference } = deblind(verdict, mapping);
  return {
    scenarioId: pair.scenario.id,
    seed: pair.seed,
    model,
    mapping,
    arms,
    preference,
    preferenceReason: verdict.preferenceReason,
    usage: toUsage(response.usage),
  };
}

/** Judgments a previous invocation against the same run dir already paid for. */
async function readJudgments(runDir: string): Promise<JudgmentRow[]> {
  const file = Bun.file(judgmentsPath(runDir));
  if (!(await file.exists())) return [];
  return decodeJsonLines(JudgmentRow, await file.text(), judgmentsPath(runDir));
}

export function meanScores(rows: JudgmentRow[], arm: Arm): Record<Axis, number> {
  const mean = (axis: Axis): number => {
    const scores = rows.map((row) => row.arms[arm][axis].score);
    return scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
  };
  return {
    narrationLeak: mean("narrationLeak"),
    verbosity: mean("verbosity"),
    selfContained: mean("selfContained"),
    substanceRetention: mean("substanceRetention"),
  };
}

export function formatSummary(rows: JudgmentRow[]): string {
  const lines: string[] = [`${rows.length} judged pairs`, ""];
  const a = meanScores(rows, "a");
  const b = meanScores(rows, "b");
  lines.push("| axis | arm A | arm B | B - A |", "| --- | --- | --- | --- |");
  for (const axis of AXES) {
    const delta = b[axis] - a[axis];
    lines.push(
      `| ${axis} | ${a[axis].toFixed(2)} | ${b[axis].toFixed(2)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} |`,
    );
  }
  const tally = { a: 0, b: 0, tie: 0 };
  for (const row of rows) tally[row.preference]++;
  lines.push("", `Preference: A ${tally.a}, B ${tally.b}, tie ${tally.tie}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const dir = join(import.meta.dirname, "..");
  const argv = cli({
    name: "judge",
    help: {
      description:
        "Score a run's arm A / arm B bodies pairwise and blind, then de-blind the verdicts.",
    },
    parameters: ["<run-dir>"],
    flags: {
      scenarios: {
        type: String,
        default: join(dir, "scenarios"),
        description: "Directory of scenario JSON files",
      },
      prompt: {
        type: String,
        default: join(dir, "judge-prompt.md"),
        description: "Rubric the judge grades against",
      },
      model: { type: String, default: JUDGE_MODEL, description: "Judge model" },
      concurrency: { type: Number, default: 5, description: "API calls in flight" },
    },
  });

  requireApiKey();
  const runDir = argv._.runDir;
  const prompt = await Bun.file(argv.flags.prompt).text();
  const scenarios = await loadScenarios(argv.flags.scenarios);
  const pairs = buildPairs(scenarios, await readGenerations(runDir));
  if (pairs.length === 0) throw new Error(`No complete A/B pairs in ${runDir}`);

  const judged = await readJudgments(runDir);
  const seen = new Set(judged.map((row) => pairKey(row.scenarioId, row.seed)));
  const pending = pairs.filter((pair) => !seen.has(pairKey(pair.scenario.id, pair.seed)));
  if (judged.length > 0) {
    console.error(`resuming: ${judged.length} pairs already judged, ${pending.length} left`);
  }

  const client = new Anthropic({ maxRetries: MAX_RETRIES });
  // The sink truncates on open, so the judgments carried over are written back first.
  const writer = Bun.file(judgmentsPath(runDir)).writer();
  const total = emptyUsage();
  const emit = async (row: JudgmentRow): Promise<void> => {
    await writer.write(`${JSON.stringify(row)}\n`);
    await writer.flush();
  };
  for (const row of judged) {
    addUsage(total, row.usage);
    await emit(row);
  }
  let done = 0;

  const fresh = await mapPool(pending, argv.flags.concurrency, async (pair) => {
    const mapping = blind(Math.random() < 0.5);
    const row = await judgePair(client, pair, mapping, prompt, argv.flags.model);
    addUsage(total, row.usage);
    await emit(row);
    done++;
    console.error(`[${done}/${pending.length}] ${pair.scenario.id} seed ${pair.seed}`);
    return row;
  });

  await writer.end();

  const cost = costUsd(total, JUDGE_RATES);
  console.log(formatSummary([...judged, ...fresh]));
  console.error(
    `\n${formatUsage(total)} tokens, $${cost.toFixed(4)} (${argv.flags.model} list price)`,
  );
}

if (import.meta.main) {
  await main();
}
