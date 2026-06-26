#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: shells out to `claude -p` to generate and judge plans
/**
 * Pairwise A/B harness for testing a candidate guidance idea against the
 * baseline plan guidelines. For each fixture in fixtures/, it generates one
 * plan under control (the baseline guidelines) and one under treatment (the
 * baseline plus the candidate snippet from --candidate), then a judge pass
 * compares the two head-to-head and picks the better plan on four qualities:
 * right-sized detail, outcome focus, scope discipline, and grounding.
 *
 * The metric is treatment's win rate over control. Fifty percent means the
 * candidate changed nothing. Each fixture runs `--reps` times to average out
 * per-generation noise. Position bias is counterbalanced: which plan the
 * judge sees first alternates by fixture and rep, then the verdict is mapped
 * back to control/treatment.
 *
 * The candidate lives in its own file under candidates/ so the baseline
 * guidelines stay unchanged while an idea is under test. Swap --candidate to
 * measure a different wording; the win rate is the verdict.
 *
 * Generation runs in an empty temp directory with a greenfield framing, so
 * the grounding rules ("read the code first") never trigger a refusal about
 * the surrounding repo. Fixtures carry their own context for the plan to
 * ground against.
 *
 * Local and manual. It runs `claude -p` fixtures x reps x 3 times (two
 * generations and one judgment per rep), so it never runs in CI. Fixtures are
 * authored and egress-clean, so generated plans are safe to inspect.
 * Artifacts go to tmp/ab/.
 */
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { cli } from "cleye";
import matter from "gray-matter";
import { table } from "table";
import { BOLD, DIM, percent, RESET, wilson } from "../scripts/alternatives-scan";

type Side = "A" | "B" | "tie";
type Verdict = "control" | "treatment" | "tie";
type Quality = "right_sized_detail" | "outcome_focused" | "scope_discipline" | "grounded";

const QUALITIES: Quality[] = [
  "right_sized_detail",
  "outcome_focused",
  "scope_discipline",
  "grounded",
];
const QUALITY_LABELS: Record<Quality, string> = {
  right_sized_detail: "right-sized detail",
  outcome_focused: "outcome-focused",
  scope_discipline: "scope discipline",
  grounded: "grounded",
};
const SIDES: Side[] = ["A", "B", "tie"];

interface Fixture {
  name: string;
  prompt: string;
}

export interface JudgeResult {
  overall: Side;
  qualities: Record<Quality, Side>;
  rationale: string;
}

/** A judgment with sides mapped back to the conditions they stand for. */
export interface Comparison {
  overall: Verdict;
  qualities: Record<Quality, Verdict>;
}

async function loadFixtures(dir: string): Promise<Fixture[]> {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const parsed = matter(await Bun.file(path.join(dir, name)).text());
      const prompt = parsed.content.trim();
      if (prompt.length === 0) {
        throw new Error(`${name}: fixture has no request body`);
      }
      return { name, prompt };
    }),
  );
}

/**
 * Compose the treatment guidelines by appending the candidate snippet to the
 * baseline. Control is the baseline verbatim, so the candidate text is the
 * only difference between conditions.
 */
export function composeTreatment(baseline: string, candidate: string): string {
  return `${baseline.trimEnd()}\n\n${candidate.trim()}\n`;
}

/**
 * The generator prompt. The greenfield framing is load-bearing: it removes
 * the grounding rules' basis for refusing ("this repo has no such code"),
 * which sank generations in the first cut. The fixture supplies whatever
 * context the plan should ground against.
 */
function generatorPrompt(guidelines: string, fixturePrompt: string): string {
  return [
    "You are in planning mode. The following planning guidelines apply.",
    "",
    "<planning-guidelines>",
    guidelines.trim(),
    "</planning-guidelines>",
    "",
    "This is a greenfield design exercise. There is no repository on disk to",
    "inspect beyond what the request itself provides. Plan from the request",
    "and any context it gives. Produce an implementation plan as markdown for",
    "the request below. Output only the plan, with no preamble.",
    "",
    fixturePrompt,
  ].join("\n");
}

function judgePrompt(template: string, request: string, planA: string, planB: string): string {
  return template
    .replace("{{REQUEST}}", request)
    .replace("{{PLAN_A}}", planA)
    .replace("{{PLAN_B}}", planB);
}

/**
 * Run `claude -p`, retrying on a non-zero exit. Transient CLI failures (rate
 * limits, flaky API responses) are common across a long run. One bad call
 * costs only a retry this way. Empty stderr is normal on these, so the error
 * carries the head of stdout too for diagnosis.
 */
async function runClaude(
  prompt: string,
  model: string | undefined,
  cwd: string,
  attempts = 5,
): Promise<string> {
  const args = ["claude", "-p", "--no-session-persistence"];
  if (model) args.push("--model", model);
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const proc = Bun.spawn(args, {
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exit === 0) return stdout.trim();
    lastError = `exit ${exit}: ${(stderr.trim() || stdout.trim()).slice(0, 300)}`;
    // Exponential backoff: server-side rate limiting ("temporarily limiting
    // requests") clears on the order of seconds, so 2s, 4s, 8s, 16s.
    if (attempt < attempts) await Bun.sleep(1000 * 2 ** attempt);
  }
  throw new Error(`claude -p failed after ${attempts} attempts (${lastError})`);
}

function asSide(value: unknown): Side | undefined {
  return typeof value === "string" && SIDES.includes(value as Side) ? (value as Side) : undefined;
}

/**
 * Slice the first complete JSON object out of the judge output. Scanning for
 * the brace that balances the first `{` (skipping braces inside strings)
 * tolerates prose on either side, where a stray `{` or `}` in a trailing
 * sentence would otherwise corrupt a naive first-to-last-brace span.
 */
function extractJsonObject(output: string): string {
  const start = output.indexOf("{");
  if (start === -1) {
    throw new Error(`judge returned no JSON object: ${output.slice(0, 200)}`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < output.length; i++) {
    const char = output[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return output.slice(start, i + 1);
  }
  throw new Error(
    `judge returned an unterminated JSON object: ${output.slice(start, start + 200)}`,
  );
}

export function parseJudge(output: string): JudgeResult {
  const parsed = JSON.parse(extractJsonObject(output)) as Record<string, unknown>;
  const overall = asSide(parsed.overall);
  if (overall === undefined) {
    throw new Error(`judge returned an invalid overall verdict: ${String(parsed.overall)}`);
  }
  const rawQualities = (parsed.qualities ?? {}) as Record<string, unknown>;
  const qualities = Object.fromEntries(
    QUALITIES.map((key) => [key, asSide(rawQualities[key]) ?? "tie"]),
  ) as Record<Quality, Side>;
  return {
    overall,
    qualities,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

/**
 * Map a judged side back to the condition it stood for. `controlFirst` records
 * which condition was shown as plan A, so the verdict survives the position
 * counterbalancing.
 */
export function resolveSide(side: Side, controlFirst: boolean): Verdict {
  if (side === "tie") return "tie";
  return (side === "A") === controlFirst ? "control" : "treatment";
}

export function resolveComparison(judge: JudgeResult, controlFirst: boolean): Comparison {
  const qualities = Object.fromEntries(
    QUALITIES.map((key) => [key, resolveSide(judge.qualities[key], controlFirst)]),
  ) as Record<Quality, Verdict>;
  return { overall: resolveSide(judge.overall, controlFirst), qualities };
}

export interface DimensionResult {
  control: number;
  treatment: number;
  tie: number;
  decisive: number;
  /** Treatment wins as a share of decisive (non-tie) comparisons. */
  treatmentWinRate: number;
  ci: { lo: number; hi: number };
}

export interface Summary {
  n: number;
  overall: DimensionResult;
  qualities: Record<Quality, DimensionResult>;
}

function tally(verdicts: Verdict[]): DimensionResult {
  let control = 0;
  let treatment = 0;
  let tie = 0;
  for (const verdict of verdicts) {
    if (verdict === "control") control++;
    else if (verdict === "treatment") treatment++;
    else tie++;
  }
  const decisive = control + treatment;
  return {
    control,
    treatment,
    tie,
    decisive,
    treatmentWinRate: decisive > 0 ? treatment / decisive : 0,
    ci: wilson(treatment, decisive),
  };
}

export function summarize(comparisons: Comparison[]): Summary {
  const qualities = Object.fromEntries(
    QUALITIES.map((key) => [key, tally(comparisons.map((c) => c.qualities[key]))]),
  ) as Record<Quality, DimensionResult>;
  return {
    n: comparisons.length,
    overall: tally(comparisons.map((c) => c.overall)),
    qualities,
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i];
      if (item !== undefined) results[i] = await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function dimensionRow(label: string, d: DimensionResult): string[] {
  return [
    label,
    String(d.control),
    String(d.treatment),
    String(d.tie),
    d.decisive > 0
      ? `${percent(d.treatmentWinRate)} [${percent(d.ci.lo)}..${percent(d.ci.hi)}]`
      : "—",
  ];
}

interface Unit {
  fixture: Fixture;
  fixtureIndex: number;
  rep: number;
}

async function main(): Promise<void> {
  const argv = cli({
    name: "ab",
    flags: {
      fixtures: {
        type: String,
        description: "Directory of fixture requests",
        default: path.join(import.meta.dirname, "fixtures"),
      },
      guidelines: {
        type: String,
        description: "Baseline planning guidelines (the control condition)",
        default: path.join(import.meta.dirname, "..", "references", "guidelines.md"),
      },
      candidate: {
        type: String,
        description: "Candidate snippet appended to the baseline to form the treatment",
        default: path.join(import.meta.dirname, "candidates", "alternatives-section.md"),
      },
      reps: {
        type: Number,
        description: "Comparisons per fixture",
        default: 5,
      },
      model: {
        type: String,
        description: "Model passed to claude -p (default: the CLI default)",
      },
      concurrency: {
        type: Number,
        description: "Concurrent comparison units",
        default: 4,
      },
      out: {
        type: String,
        description: "Output directory for generated plans and judge results",
        default: path.join("tmp", "ab"),
      },
    },
  });

  const control = await Bun.file(argv.flags.guidelines).text();
  const candidate = await Bun.file(argv.flags.candidate).text();
  if (candidate.trim().length === 0) {
    console.error(`${argv.flags.candidate} is empty; nothing to A/B.`);
    process.exit(1);
  }
  const treatment = composeTreatment(control, candidate);

  const judgeTemplate = await Bun.file(path.join(import.meta.dirname, "judge.md")).text();
  const fixtures = await loadFixtures(argv.flags.fixtures);
  const units: Unit[] = fixtures.flatMap((fixture, fixtureIndex) =>
    Array.from({ length: argv.flags.reps }, (_, rep) => ({ fixture, fixtureIndex, rep })),
  );

  mkdirSync(argv.flags.out, { recursive: true });
  const genCwd = mkdtempSync(path.join(tmpdir(), "ab-gen-"));
  console.error(`${DIM}Candidate: ${argv.flags.candidate}${RESET}`);
  console.error(
    `${DIM}Running ${units.length} comparison units ` +
      `(${fixtures.length} fixtures x ${argv.flags.reps} reps, ${units.length * 3} claude calls), ` +
      `concurrency ${argv.flags.concurrency}. Generation cwd: ${genCwd}.${RESET}`,
  );

  const judged = await mapPool(units, argv.flags.concurrency, async (unit) => {
    const stem = `${unit.fixture.name.replace(/\.md$/, "")}.r${unit.rep}`;
    const controlFirst = (unit.fixtureIndex + unit.rep) % 2 === 0;
    try {
      const controlPlan = await runClaude(
        generatorPrompt(control, unit.fixture.prompt),
        argv.flags.model,
        genCwd,
      );
      const treatmentPlan = await runClaude(
        generatorPrompt(treatment, unit.fixture.prompt),
        argv.flags.model,
        genCwd,
      );
      const planA = controlFirst ? controlPlan : treatmentPlan;
      const planB = controlFirst ? treatmentPlan : controlPlan;
      const judge = parseJudge(
        await runClaude(
          judgePrompt(judgeTemplate, unit.fixture.prompt, planA, planB),
          argv.flags.model,
          genCwd,
        ),
      );
      const comparison = resolveComparison(judge, controlFirst);
      await Bun.write(path.join(argv.flags.out, `${stem}.control.md`), controlPlan);
      await Bun.write(path.join(argv.flags.out, `${stem}.treatment.md`), treatmentPlan);
      await Bun.write(
        path.join(argv.flags.out, `${stem}.judge.json`),
        JSON.stringify({ controlFirst, judge, comparison }, null, 2),
      );
      console.error(`${DIM}  done: ${stem} (overall: ${comparison.overall})${RESET}`);
      return comparison;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED: ${stem}: ${message}`);
      return null;
    }
  });

  const ok = judged.filter((entry): entry is Comparison => Boolean(entry));
  const failed = judged.length - ok.length;
  if (failed > 0) {
    // Dropped units are not a random sample: a condition that fails more often
    // (e.g. the longer treatment prompt hitting a limit) skews the survivors,
    // so the win rate below is computed over a biased subset. Flag it loudly.
    console.error(
      `${BOLD}Warning: ${failed} of ${judged.length} units failed and were dropped.${RESET} ` +
        `Failures may correlate with condition, so the win rate is over a biased subset. ` +
        `Re-run the failures or raise --reps before trusting a verdict.`,
    );
  }

  const summary = summarize(ok);
  console.log(
    `${BOLD}Plan guidance A/B${RESET} ${DIM}(${fixtures.length} fixtures x ${argv.flags.reps} reps, n=${summary.n})${RESET}`,
  );
  console.log(
    table([
      ["dimension", "ctrl", "treat", "tie", "treat win [95% CI]"],
      ...QUALITIES.map((key) => dimensionRow(QUALITY_LABELS[key], summary.qualities[key])),
      dimensionRow("overall", summary.overall),
    ]),
  );
  const headline = summary.overall;
  const verdict =
    headline.ci.lo > 0.5
      ? "treatment wins"
      : headline.ci.hi < 0.5
        ? "control wins"
        : "no decision (CI spans 50%)";
  console.log(
    `${DIM}Overall treatment win rate ${percent(headline.treatmentWinRate)} ` +
      `[${percent(headline.ci.lo)}..${percent(headline.ci.hi)}] over ${headline.decisive} decisive ` +
      `comparisons (${headline.tie} ties): ${verdict}. 50% means no effect.${RESET}`,
  );
  console.error(
    `${DIM}Plans and judge results in ${argv.flags.out}/ (synthetic fixtures; safe to inspect).${RESET}`,
  );
}

if (import.meta.main) {
  await main();
}
