#!/usr/bin/env bun
import { cli, command } from "cleye";
import { type LabeledHeading, parseLabelsFile, SHOULD_FLAG, wilson } from "./headings-eval";
import {
  anthropicChunkJudge,
  anthropicHeadingJudge,
  anthropicTokenCounter,
  type ChunkJudge,
  estimateCost,
  estimateHeadingCost,
  HEADING_PROMPT_PATH,
  type HeadingJudge,
  JUDGE_CRITERIA,
  JUDGE_MODEL,
  judgeCorpus,
  judgeDocument,
  judgeHeadings,
  loadPrompt,
  type MeaningAudit,
} from "./judge";
import { JUDGE_FIXTURES, JUDGE_PROMPT_SHA256, type JudgeFixture } from "./judge-fixtures";

/**
 * Runner for the meaning-layer judge outside the analyze pipeline:
 *
 * - `files`: judge ad-hoc documents and print the per-criterion audit.
 * - `gate`: replay the committed reproducibility tuples (judge-fixtures.ts)
 *   against the live judge. Local-only by design: CI has no API key, and the
 *   gate's job is drift detection at measurement time, not per-commit
 *   blocking.
 * - `headings`: the #769 reference baseline. Point the judge at a labeled
 *   heading file and report precision/recall against the existing labels.
 *
 * Every mode requires ANTHROPIC_API_KEY and prints a cost estimate before
 * making any call.
 */

export interface GateMismatch {
  criterion: string;
  expected: boolean;
  actual: boolean;
  span: string | null;
}

export interface GateResult {
  id: string;
  kind: JudgeFixture["kind"];
  pass: boolean;
  mismatches: GateMismatch[];
}

/** The judge samples, so the gate replays every tuple this many times by default. */
export const DEFAULT_GATE_RUNS = 5;

/**
 * Replays each fixture tuple against `judge` `runs` times, one result per
 * fixture per run. Throws when the committed prompt no longer matches the
 * pinned hash: expectations from a different prompt version say nothing about
 * this one.
 */
export async function runGate(
  judge: ChunkJudge,
  promptSha256: string,
  runs = 1,
): Promise<GateResult[]> {
  if (promptSha256 !== JUDGE_PROMPT_SHA256) {
    throw new Error(
      `Prompt hash ${promptSha256.slice(0, 12)} does not match the pinned tuple hash ${JUDGE_PROMPT_SHA256.slice(0, 12)}. Re-validate the fixtures against the edited prompt and update JUDGE_PROMPT_SHA256.`,
    );
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`Gate runs must be a positive integer, got ${runs}`);
  }
  const fixtures = Array.from({ length: runs }, () => JUDGE_FIXTURES).flat();
  const results: GateResult[] = [];
  for (const fixture of fixtures) {
    // oxlint-disable-next-line no-await-in-loop -- one judge API call per fixture; serializing keeps the gate inside the rate limit.
    const verdict = await judgeDocument(judge, fixture.text);
    const mismatches: GateMismatch[] = [];
    for (const criterion of JUDGE_CRITERIA) {
      const expected = fixture.expect[criterion.key];
      if (expected === undefined) continue;
      const actual = verdict[criterion.key];
      if (actual.flagged !== expected) {
        mismatches.push({
          criterion: criterion.id,
          expected,
          actual: actual.flagged,
          span: actual.span,
        });
      }
    }
    results.push({ id: fixture.id, kind: fixture.kind, pass: mismatches.length === 0, mismatches });
  }
  return results;
}

export interface GatePassRate {
  id: string;
  passes: number;
  runs: number;
  missed: string[];
}

/** Per-fixture pass counts across runs, in fixture order. */
export function passRates(results: GateResult[]): GatePassRate[] {
  const rates = new Map<string, GatePassRate>();
  for (const result of results) {
    const rate = rates.get(result.id) ?? { id: result.id, passes: 0, runs: 0, missed: [] };
    rate.runs++;
    if (result.pass) rate.passes++;
    for (const { criterion } of result.mismatches) {
      if (!rate.missed.includes(criterion)) rate.missed.push(criterion);
    }
    rates.set(result.id, rate);
  }
  return [...rates.values()];
}

export function formatPassRate({ id, passes, runs, missed }: GatePassRate): string {
  const line = `${id.padEnd(36)} ${passes}/${runs}`;
  return missed.length > 0 ? `${line}  missed: ${missed.join(", ")}` : line;
}

export interface HeadingBaselineScore {
  total: number;
  flagged: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  precisionLo: number;
  precisionHi: number;
  recall: number;
}

/** Scores judge verdicts against the labeled headings (clause/imperative flag). */
export function scoreHeadingBaseline(
  labeled: LabeledHeading[],
  verdicts: boolean[],
): HeadingBaselineScore {
  if (labeled.length !== verdicts.length) {
    throw new Error(`Got ${verdicts.length} verdicts for ${labeled.length} labeled headings`);
  }
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const [i, row] of labeled.entries()) {
    const flagged = verdicts[i] === true;
    const want = SHOULD_FLAG.has(row.label);
    if (flagged && want) tp++;
    else if (flagged && !want) fp++;
    else if (!flagged && want) fn++;
  }
  const ci = wilson(tp, tp + fp);
  return {
    total: labeled.length,
    flagged: tp + fp,
    tp,
    fp,
    fn,
    precision: tp + fp > 0 ? tp / (tp + fp) : 1,
    precisionLo: ci.lo,
    precisionHi: ci.hi,
    recall: tp + fn > 0 ? tp / (tp + fn) : 1,
  };
}

function requireApiKey(): void {
  if (
    (process.env.ANTHROPIC_API_KEY == null || process.env.ANTHROPIC_API_KEY === "") &&
    (process.env.ANTHROPIC_AUTH_TOKEN == null || process.env.ANTHROPIC_AUTH_TOKEN === "")
  ) {
    console.error(
      "Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set. The judge runs only with live API credentials.",
    );
    process.exit(1);
  }
}

function renderAudit(audit: MeaningAudit): string {
  const lines = [
    `prompt: ${audit.promptSha256}`,
    `model: ${audit.model}`,
    `documents: ${audit.documents}`,
    `estimated cost: $${audit.estimatedCostUsd.toFixed(4)}`,
    "",
    "criterion                 flagged  rate",
  ];
  for (const stat of audit.criteria) {
    const rate = stat.total > 0 ? `${((stat.flagged / stat.total) * 100).toFixed(0)}%` : "-";
    lines.push(`${stat.id.padEnd(26)}${String(stat.flagged).padStart(7)}  ${rate}`);
  }
  for (const stat of audit.criteria) {
    if (stat.spans.length === 0) continue;
    lines.push("", `${stat.id} spans:`);
    for (const span of stat.spans) lines.push(`  - "${span}"`);
  }
  return lines.join("\n");
}

async function filesMain(paths: string[], model: string, limit: number): Promise<void> {
  requireApiKey();
  const prompt = await loadPrompt();
  const texts = await Promise.all(paths.slice(0, limit).map((p) => Bun.file(p).text()));
  const cost = await estimateCost(texts, {
    promptText: prompt.text,
    model,
    countTokens: anthropicTokenCounter({ prompt: prompt.text, model }),
  });
  console.error(
    `Judging ${texts.length} documents: ${cost.calls} calls, est. $${cost.usd.toFixed(4)} on ${model}`,
  );
  const judge = anthropicChunkJudge({ prompt: prompt.text, model });
  const audit = await judgeCorpus(judge, texts, {
    promptSha256: prompt.sha256,
    model,
    estimatedCostUsd: cost.usd,
  });
  console.log(renderAudit(audit));
}

async function gateMain(model: string, runs: number): Promise<void> {
  requireApiKey();
  const prompt = await loadPrompt();
  const texts = JUDGE_FIXTURES.map((f) => f.text);
  const cost = await estimateCost(texts, {
    promptText: prompt.text,
    model,
    countTokens: anthropicTokenCounter({ prompt: prompt.text, model }),
  });
  console.error(
    `Gating ${JUDGE_FIXTURES.length} fixtures x ${runs} runs: ${cost.calls * runs} calls, est. $${(cost.usd * runs).toFixed(4)} on ${model}`,
  );
  const judge = anthropicChunkJudge({ prompt: prompt.text, model });
  const rates = passRates(await runGate(judge, prompt.sha256, runs));
  for (const rate of rates) console.log(formatPassRate(rate));
  const held = rates.filter((r) => r.passes === r.runs).length;
  console.log(
    `\n${held}/${rates.length} tuples hold on every run (prompt ${prompt.sha256.slice(0, 12)})`,
  );
  if (held < rates.length) process.exit(1);
}

async function headingsMain(labelsPath: string, model: string, limit: number): Promise<void> {
  requireApiKey();
  const prompt = await loadPrompt(HEADING_PROMPT_PATH);
  const labeled = parseLabelsFile(await Bun.file(labelsPath).text()).slice(0, limit);
  if (labeled.length === 0) {
    console.error(`No labeled headings found in ${labelsPath}`);
    process.exit(1);
  }
  const cost = await estimateHeadingCost(
    labeled.map((l) => l.heading),
    {
      promptText: prompt.text,
      model,
      countTokens: anthropicTokenCounter({ prompt: prompt.text, model }),
    },
  );
  console.error(
    `Judging ${labeled.length} headings in ${cost.calls} batched calls, est. $${cost.usd.toFixed(4)} on ${model}`,
  );
  const judge: HeadingJudge = anthropicHeadingJudge({ prompt: prompt.text, model });
  const verdicts = await judgeHeadings(
    judge,
    labeled.map((l) => l.heading),
  );
  const all = scoreHeadingBaseline(labeled, verdicts);
  const randomRows = labeled
    .map((row, i) => ({ row, verdict: verdicts[i] === true }))
    .filter((x) => x.row.source === "random");
  const random = scoreHeadingBaseline(
    randomRows.map((x) => x.row),
    randomRows.map((x) => x.verdict),
  );
  console.log(`heading judge reference baseline (prompt ${prompt.sha256.slice(0, 12)}, ${model})`);
  for (const [name, score] of [
    ["all labeled", all],
    ["random subset", random],
  ] as const) {
    console.log(
      `${name.padEnd(15)} n=${score.total} flagged=${score.flagged} precision=${(score.precision * 100).toFixed(1)}% (${(score.precisionLo * 100).toFixed(1)}..${(score.precisionHi * 100).toFixed(1)}) recall=${(score.recall * 100).toFixed(1)}%`,
    );
  }
  console.log(
    "\nRecord this aggregate (not the headings) in skills/analyze/references/linguistics.md as the #769 upper-reference for the tagger promotion decision.",
  );
}

if (import.meta.main) {
  const filesCmd = command(
    {
      name: "files",
      parameters: ["<paths...>"],
      help: { description: "Judge documents from files and print the per-criterion audit" },
      flags: {
        model: { type: String, description: "Judge model", default: JUDGE_MODEL },
        limit: { type: Number, description: "Max documents to judge", default: 100 },
      },
    },
    async (parsed) => {
      await filesMain(parsed._.paths, parsed.flags.model, parsed.flags.limit);
    },
  );

  const gateCmd = command(
    {
      name: "gate",
      help: {
        description:
          "Replay the committed reproducibility tuples against the live judge (local-only)",
      },
      flags: {
        model: { type: String, description: "Judge model", default: JUDGE_MODEL },
        runs: { type: Number, description: "Replays per tuple", default: DEFAULT_GATE_RUNS },
      },
    },
    async (parsed) => {
      await gateMain(parsed.flags.model, parsed.flags.runs);
    },
  );

  const headingsCmd = command(
    {
      name: "headings",
      parameters: ["<labels>"],
      help: {
        description:
          "Reference baseline for #769: judge labeled headings (TSV from headings-eval --sample) and score against the labels",
      },
      flags: {
        model: { type: String, description: "Judge model", default: JUDGE_MODEL },
        limit: { type: Number, description: "Max headings to judge", default: 500 },
      },
    },
    async (parsed) => {
      await headingsMain(parsed._.labels, parsed.flags.model, parsed.flags.limit);
    },
  );

  await cli(
    {
      name: "judge-run",
      help: {
        description: "Run the meaning-layer LLM judge (batch-only, needs ANTHROPIC_API_KEY)",
      },
      commands: [filesCmd, gateCmd, headingsCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
