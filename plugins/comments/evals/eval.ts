#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";
import { stripCommentMarkers } from "../apply/edits";
import { collectVerdicts } from "../apply/join";
import { type DocComment, DocCommentSchema } from "../detection/doc";
import { type Provenance, ProvenanceSchema } from "../detection/provenance";
import type { CommentKind, Language } from "../detection/types";
import { workflowJudge } from "../judge/adapter";
import { buildJob, type ShardComment, writeJob } from "../judge/job";
import { loadPrompt } from "../judge/judge";
import {
  SLOP_CATEGORIES,
  type SlopCategory,
  VERDICT_ACTIONS,
  type Verdict,
  type VerdictAction,
} from "../judge/schema";
import {
  anthropicCommentJudge,
  type CommentJudgeInput,
  JUDGE_MODEL,
  judgeComments,
} from "./oracle";

/**
 * One labeled comment with the surrounding context the judge sees. `action`
 * partitions the corpus: `keep` must keep its `fact`, `trim` must be trimmed
 * (to text carrying `fact` when there is a gold `trimTo`), `rewrite` must be
 * rewritten. Losing a `keep` fixture's fact is the destructive error.
 */
export interface Fixture {
  id: string;
  path: string;
  language: Language;
  kind: CommentKind;
  comment: string;
  context: string;
  action: VerdictAction;
  category: SlopCategory | null;
  /** For `action: "rewrite"`: the owner's gold de-voiced text, for hand spot-checks. */
  rewrite?: string | null;
  /** For a partial `trim`: the owner's gold kept-comment text, for hand spot-checks. */
  trimTo?: string;
  /** Phrases the surviving text must carry. Required on `keep` and on a `trim` with `trimTo`. */
  fact?: string[];
  /** The phrase `judge/prompt.md` quotes from this fixture, which keeps it out of the headline numbers. */
  quoted?: string;
  /** Absent fixtures are judged as agent-written, the rubric's default. */
  provenance?: Provenance;
  /** The doc-comment classification extraction would attach. */
  doc?: DocComment;
  source?: string;
  note?: string;
}

export const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export async function loadFixtures(dir: string = FIXTURES_DIR): Promise<Fixture[]> {
  const glob = new Glob("*.json");
  const fixtures: Fixture[] = [];
  for await (const file of glob.scan(dir)) {
    const parsed: unknown = JSON.parse(await Bun.file(join(dir, file)).text());
    fixtures.push(validateFixture(parsed, file));
  }
  fixtures.sort((a, b) => a.id.localeCompare(b.id));
  return fixtures;
}

/**
 * The most surviving text a `trimTo` fixture accepts, as a share of the original
 * comment. Judged trims kept 0.33 to 0.89 of it, so this fails an echo. Gold
 * length is the wrong base: an echo can sit under a legitimate trim's multiple.
 */
export const RETENTION_CEILING = 0.9;

function overCeiling(kept: string, comment: string): boolean {
  return kept.length > RETENTION_CEILING * comment.length;
}

const nonEmpty = (name: string) =>
  z.string({ error: `missing required string "${name}"` }).min(1, {
    error: `missing required string "${name}"`,
  });

const FixtureInput = z
  .looseObject(
    {
      id: nonEmpty("id"),
      path: nonEmpty("path"),
      language: nonEmpty("language"),
      kind: z.enum(["line", "block", "docstring"], {
        error: (issue) => `has an invalid comment kind ${JSON.stringify(issue.input)}`,
      }) satisfies z.ZodType<CommentKind>,
      comment: nonEmpty("comment"),
      context: nonEmpty("context"),
      action: z.enum(VERDICT_ACTIONS, {
        error: (issue) => `has an invalid action ${JSON.stringify(issue.input)}`,
      }),
      category: z
        .enum(SLOP_CATEGORIES, {
          error: (issue) => `has an invalid slop category ${JSON.stringify(issue.input)}`,
        })
        .nullish(),
      rewrite: z.string().nullish(),
      trimTo: z.string().nullish(),
      fact: z.union([nonEmpty("fact"), z.array(nonEmpty("fact")).min(1)]).nullish(),
      quoted: nonEmpty("quoted").nullish(),
      provenance: ProvenanceSchema.nullish(),
      doc: DocCommentSchema.nullish(),
      source: z.string().nullish(),
      note: z.string().nullish(),
    },
    { error: "is not an object" },
  )
  .superRefine((fixture, ctx) => {
    if (fixture.action === "keep" && fixture.category != null) {
      ctx.addIssue({ code: "custom", message: `is "keep" but carries a category` });
    }
    if (fixture.action !== "keep" && fixture.category == null) {
      ctx.addIssue({ code: "custom", message: "has an invalid slop category null" });
    }
    if (fixture.action === "rewrite" && (fixture.rewrite == null || fixture.rewrite === "")) {
      ctx.addIssue({ code: "custom", message: `is "rewrite" but carries no gold rewrite text` });
    }
    if (fixture.trimTo != null && (fixture.trimTo.length === 0 || fixture.action !== "trim")) {
      ctx.addIssue({
        code: "custom",
        message: `"trimTo" must be a non-empty string on a "trim" fixture`,
      });
    }
    if (fixture.trimTo != null && overCeiling(fixture.trimTo, fixture.comment)) {
      ctx.addIssue({ code: "custom", message: `"trimTo" is over the retention ceiling itself` });
    }
    const facts = fixture.fact == null ? [] : [fixture.fact].flat();
    if (facts.length === 0 && (fixture.action === "keep" || fixture.trimTo != null)) {
      ctx.addIssue({ code: "custom", message: `needs a "fact" on a "keep" or "trimTo" fixture` });
    }
    for (const [field, text] of [
      ["comment", fixture.comment],
      ["trimTo", fixture.trimTo],
    ] as const) {
      if (text != null && facts.length > 0 && !carriesFact(text, facts)) {
        ctx.addIssue({ code: "custom", message: `"fact" does not appear in its ${field}` });
      }
    }
  });

function validateFixture(value: unknown, file: string): Fixture {
  const parsed = FixtureInput.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue != null && issue.path.length > 0 ? ` at ${issue.path.join(".")}:` : "";
    throw new Error(`Fixture ${file}${field} ${issue?.message}`);
  }
  const decoded = parsed.data;

  const fixture: Fixture = {
    id: decoded.id,
    path: decoded.path,
    language: decoded.language,
    kind: decoded.kind,
    comment: decoded.comment,
    context: decoded.context,
    action: decoded.action,
    category: decoded.category ?? null,
  };
  if (decoded.trimTo != null) fixture.trimTo = decoded.trimTo;
  if (decoded.rewrite != null) fixture.rewrite = decoded.rewrite;
  if (decoded.fact != null) fixture.fact = [decoded.fact].flat();
  if (decoded.quoted != null) fixture.quoted = decoded.quoted;
  if (decoded.provenance != null) fixture.provenance = decoded.provenance;
  if (decoded.doc != null) fixture.doc = decoded.doc;
  if (decoded.source != null) fixture.source = decoded.source;
  if (decoded.note != null) fixture.note = decoded.note;
  return fixture;
}

/** The fixture as the production judge sees it, so `buildJob` shards it unchanged. */
export function fixtureToShardComment(fixture: Fixture): ShardComment {
  return {
    id: fixture.id,
    path: fixture.path,
    language: fixture.language,
    kind: fixture.kind,
    text: fixture.comment,
    context: fixture.context,
    provenance: fixture.provenance,
    doc: fixture.doc,
  };
}

export function fixtureToInput(fixture: Fixture): CommentJudgeInput {
  return {
    path: fixture.path,
    language: fixture.language,
    kind: fixture.kind,
    text: fixture.comment,
    context: fixture.context,
    provenance: fixture.provenance,
    doc: fixture.doc,
  };
}

/** Comment delimiters, markup quotes, case, and wrapping, none of which change a fact. */
function normalizeForMatch(text: string): string {
  return text
    .split("\n")
    .map(stripCommentMarkers)
    .join(" ")
    .replaceAll(/[`"]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every phrase appears in the text, bounded so `2.5` does not match inside `12.5`. */
export function carriesFact(text: string, facts: string[]): boolean {
  const haystack = normalizeForMatch(text);
  return facts.every((fact) => {
    const needle = normalizeForMatch(fact);
    const before = /^\w/.test(needle) ? String.raw`(?<!\w)` : "";
    const after = /\w$/.test(needle) ? String.raw`(?!\w)` : "";
    return new RegExp(before + RegExp.escape(needle) + after).test(haystack);
  });
}

function survivingText(fixture: Fixture, verdict: Verdict): string {
  if (verdict.action === "keep") return fixture.comment;
  if (verdict.action === "rewrite") return verdict.rewrite ?? "";
  return verdict.trimTo ?? "";
}

export interface ActionMismatch {
  id: string;
  expected: VerdictAction;
  predicted: VerdictAction;
  /**
   * `fact` when the action was acceptable but the surviving text lost the fact,
   * `retention` when it kept the fact but barely shrank the comment.
   */
  reason: "action" | "fact" | "retention";
}

/** Keep precision and slop recall over one partition of the corpus. */
export interface Bucket {
  keeps: number;
  /** `keep` fixtures whose fact the judge's trim or rewrite dropped. */
  destructive: number;
  /** 1 - destructive / keeps. */
  keepPrecision: number;
  slop: number;
  /** `trim`/`rewrite` fixtures the judge did not keep. */
  flagged: number;
  /** flagged / slop. */
  slopRecall: number;
}

export interface Metrics {
  total: number;
  correct: number;
  /** correct / total. 1 when there is nothing to score. */
  accuracy: number;
  mismatches: ActionMismatch[];
  /** `keep` fixtures whose fact did not survive. The ship gate. */
  keepViolations: string[];
  /** For correctly actioned `trim`/`rewrite`, how often the category also matched. */
  categoryMatches: number;
  /** Fixtures `judge/prompt.md` does not quote. */
  headline: Bucket;
  /** Fixtures `judge/prompt.md` quotes, which the rubric was tuned against. */
  quoted: Bucket;
  /** Surviving chars over gold `trimTo` chars, per flagged `trimTo` fixture that kept its fact. */
  retention: Record<string, number>;
  /** Mean of `retention` over headline fixtures, or null when none was recorded. */
  meanRetention: number | null;
}

function emptyBucket(): Bucket {
  return { keeps: 0, destructive: 0, keepPrecision: 1, slop: 0, flagged: 0, slopRecall: 1 };
}

function finishBucket(bucket: Bucket): void {
  bucket.keepPrecision = bucket.keeps === 0 ? 1 : 1 - bucket.destructive / bucket.keeps;
  bucket.slopRecall = bucket.slop === 0 ? 1 : bucket.flagged / bucket.slop;
}

/**
 * Whether a verdict satisfies a fixture's label. A `keep` fixture passes when
 * its fact survives, so a trim down to the fact is not destructive.
 */
function outcomeOf(
  fixture: Fixture,
  verdict: Verdict,
  surviving: string,
): "pass" | ActionMismatch["reason"] {
  const { fact } = fixture;
  if (fact == null) return verdict.action === fixture.action ? "pass" : "action";
  if (fixture.action === "keep") {
    return verdict.action === "keep" || carriesFact(surviving, fact) ? "pass" : "fact";
  }
  if (fixture.trimTo != null) {
    if (verdict.action === "keep") return "action";
    if (!carriesFact(surviving, fact)) return "fact";
    return overCeiling(surviving, fixture.comment) ? "retention" : "pass";
  }
  return verdict.action === fixture.action ? "pass" : "action";
}

/**
 * Pure scorer over aligned fixtures and verdicts. Headline keep precision and
 * slop recall leave out the fixtures the rubric quotes, which report as their
 * own bucket. An empty corpus yields accuracy 1 (nothing to get wrong).
 */
export function scoreResults(fixtures: Fixture[], verdicts: Verdict[]): Metrics {
  if (fixtures.length !== verdicts.length) {
    throw new Error(`Scored ${verdicts.length} verdicts against ${fixtures.length} fixtures`);
  }
  const metrics: Metrics = {
    total: 0,
    correct: 0,
    accuracy: 1,
    mismatches: [],
    keepViolations: [],
    categoryMatches: 0,
    headline: emptyBucket(),
    quoted: emptyBucket(),
    retention: {},
    meanRetention: null,
  };
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    metrics.total++;
    const bucket = fixture.quoted == null ? metrics.headline : metrics.quoted;
    const surviving = survivingText(fixture, verdict);
    const outcome = outcomeOf(fixture, verdict, surviving);
    const passed = outcome === "pass";
    if (fixture.action === "keep") {
      bucket.keeps++;
      if (!passed) bucket.destructive++;
    } else {
      bucket.slop++;
      if (verdict.action !== "keep") bucket.flagged++;
    }
    if (passed) {
      metrics.correct++;
      if (fixture.action !== "keep" && verdict.category === fixture.category) {
        metrics.categoryMatches++;
      }
    } else {
      metrics.mismatches.push({
        id: fixture.id,
        expected: fixture.action,
        predicted: verdict.action,
        reason: outcome,
      });
      if (fixture.action === "keep") metrics.keepViolations.push(fixture.id);
    }
    if (fixture.trimTo != null && (outcome === "pass" || outcome === "retention")) {
      metrics.retention[fixture.id] = surviving.length / fixture.trimTo.length;
    }
  }
  metrics.accuracy = metrics.total === 0 ? 1 : metrics.correct / metrics.total;
  finishBucket(metrics.headline);
  finishBucket(metrics.quoted);
  const ratios = fixtures
    .filter((fixture) => fixture.quoted == null)
    .flatMap((fixture) => metrics.retention[fixture.id] ?? []);
  if (ratios.length > 0) {
    metrics.meanRetention = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  }
  return metrics;
}

/** `trimTo` fixtures whose trim kept the fact but passed `RETENTION_CEILING`. */
function overRetained(metrics: Metrics): string[] {
  return metrics.mismatches.filter((m) => m.reason === "retention").map((m) => m.id);
}

function describeBucket(bucket: Bucket): string {
  return [
    `keep precision ${bucket.keepPrecision.toFixed(2)}  (${bucket.destructive} destructive / ${bucket.keeps})`,
    `slop recall ${bucket.slopRecall.toFixed(2)}  (${bucket.flagged}/${bucket.slop})`,
  ].join(", ");
}

function report(fixtures: Fixture[], verdicts: Verdict[], metrics: Metrics): string {
  const failed = new Map(metrics.mismatches.map((m) => [m.id, m.reason]));
  const rows: string[][] = [["id", "expected", "predicted", "category", "retained", "ok"]];
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    const ratio = metrics.retention[fixture.id];
    rows.push([
      fixture.quoted == null ? fixture.id : `${fixture.id} (quoted)`,
      fixture.action,
      verdict.action,
      verdict.category ?? "-",
      ratio == null ? "-" : ratio.toFixed(2),
      failed.has(fixture.id) ? `N (${failed.get(fixture.id)})` : "y",
    ]);
  }
  const summary = [
    `accuracy ${metrics.accuracy.toFixed(2)}  (${metrics.correct}/${metrics.total})`,
    `headline: ${describeBucket(metrics.headline)}`,
    `quoted:   ${describeBucket(metrics.quoted)}`,
    `trimTo retention ${metrics.meanRetention == null ? "-" : metrics.meanRetention.toFixed(2)}  (headline mean surviving/gold chars)`,
    `keep violations ${metrics.keepViolations.length}`,
    `over retention ceiling ${overRetained(metrics).length}  (surviving/original > ${RETENTION_CEILING.toFixed(2)})`,
    `category matches ${metrics.categoryMatches}`,
  ].join("\n");
  return `${table(rows)}\n${summary}`;
}

/**
 * Align the verdicts a judge wrote to the fixture order `scoreResults` expects,
 * matching on the id `buildJob` carried into the shards. A fixture with no
 * verdict, or a verdict naming no fixture, fails the run: the first means the
 * judge skipped a comment, the second means the verdicts belong to another job.
 */
export function alignVerdicts(fixtures: Fixture[], verdicts: Map<string, Verdict>): Verdict[] {
  const aligned: Verdict[] = [];
  const unjudged: string[] = [];
  for (const fixture of fixtures) {
    const verdict = verdicts.get(fixture.id);
    if (verdict) aligned.push(verdict);
    else unjudged.push(fixture.id);
  }
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  const foreign = [...verdicts.keys()].filter((id) => !ids.has(id));
  const problems: string[] = [];
  if (unjudged.length > 0) {
    problems.push(`No verdict for ${unjudged.length} fixture(s): ${unjudged.join(", ")}`);
  }
  if (foreign.length > 0) {
    problems.push(`Verdicts name ${foreign.length} unknown comment(s): ${foreign.join(", ")}`);
  }
  if (problems.length > 0) throw new Error(problems.join(". "));
  return aligned;
}

/** Where `build` materializes a job, kept apart from the audit's own job dirs. */
const EVAL_JOB_BASE = join(tmpdir(), "comments-eval");

/** Every verdict file in a job's verdicts dir, by absolute path. */
async function verdictFiles(verdictsDir: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const file of new Glob("verdict-*.json").scan(verdictsDir)) {
    paths.push(join(verdictsDir, file));
  }
  return paths;
}

/**
 * A job dir is keyed on the corpus and the rubric, so a re-run of an unchanged
 * gate reuses the dir the last one wrote. Clearing it leaves a failed judging
 * run with no verdicts for `score` to read, rather than the previous run's.
 */
export async function clearVerdicts(verdictsDir: string): Promise<void> {
  await Promise.all((await verdictFiles(verdictsDir)).map((path) => rm(path)));
}

/**
 * Shard the corpus through the production job writer and emit the `<preflight>`
 * block for the Workflow tool, so the gate judges fixtures on the path that
 * ships.
 */
async function build(jobBase: string): Promise<number> {
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found.");
    return 1;
  }
  const descriptor = await buildJob(fixtures.map(fixtureToShardComment), { fix: false });
  const written = await writeJob(descriptor, jobBase);
  await clearVerdicts(written.verdictsDir);
  console.error(
    `${written.count} fixtures / ${written.shardCount} shards (prompt ${descriptor.promptSha.slice(0, 12)})`,
  );
  await workflowJudge((line) => {
    console.log(line);
  })(written);
  console.error(`\nScore with: bun ${import.meta.path} score --job ${written.jobDir}`);
  return 0;
}

/** Every verdict file the judging agents wrote for a job, folded into one id map. */
async function readJobVerdicts(jobDir: string): Promise<Map<string, Verdict>> {
  if (!(await Bun.file(join(jobDir, "job-args.json")).exists())) {
    throw new Error(`No job at ${jobDir}. Pass the job dir printed by build.`);
  }
  const verdictsDir = join(jobDir, "verdicts");
  const files = await verdictFiles(verdictsDir);
  if (files.length === 0) {
    throw new Error(`No verdict files in ${verdictsDir}. Run the judge workflow first.`);
  }
  const texts = await Promise.all(files.map((path) => Bun.file(path).text()));
  const contents: unknown[] = [];
  for (const text of texts) {
    contents.push(JSON.parse(text));
  }
  return collectVerdicts(contents);
}

/**
 * The least headline slop recall `--gate` accepts. Set at what the production
 * workflow measures on the current rubric, so it catches a judge that keeps
 * everything without failing today's.
 */
export const RECALL_FLOOR = 1;

/** Why a gated run fails, or an empty list when it passes. */
export function gateFailures(metrics: Metrics): string[] {
  const failures: string[] = [];
  if (metrics.keepViolations.length > 0) {
    failures.push(
      `judge dropped the fact from ${metrics.keepViolations.length} must-keep comment(s): ${metrics.keepViolations.join(", ")}`,
    );
  }
  const overCeilingIds = overRetained(metrics);
  if (overCeilingIds.length > 0) {
    failures.push(
      `judge's trim kept over ${RETENTION_CEILING.toFixed(2)} of the comment on ${overCeilingIds.length} comment(s): ${overCeilingIds.join(", ")}`,
    );
  }
  if (metrics.headline.slopRecall < RECALL_FLOOR) {
    failures.push(
      `headline slop recall ${metrics.headline.slopRecall.toFixed(2)} is under the ${RECALL_FLOOR.toFixed(2)} floor`,
    );
  }
  return failures;
}

function gateOn(fixtures: Fixture[], verdicts: Verdict[], gate: boolean): number {
  const metrics = scoreResults(fixtures, verdicts);
  console.log(report(fixtures, verdicts, metrics));
  const failures = gate ? gateFailures(metrics) : [];
  if (failures.length > 0) {
    console.error(`\nSHIP GATE FAILED: ${failures.join("; ")}`);
    return 1;
  }
  return 0;
}

async function score(jobDir: string | undefined, gate: boolean): Promise<number> {
  if (jobDir == null || jobDir === "") throw new Error("--job <dir> is required.");
  const fixtures = await loadFixtures();
  return gateOn(fixtures, alignVerdicts(fixtures, await readJobVerdicts(jobDir)), gate);
}

async function oracle(model: string, gate: boolean): Promise<number> {
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found.");
    return 1;
  }
  const prompt = await loadPrompt();
  console.error(`Judging fixtures on ${model} (prompt ${prompt.sha256.slice(0, 12)})`);
  const judge = anthropicCommentJudge({ prompt: prompt.text, model });
  return gateOn(fixtures, await judgeComments(judge, fixtures.map(fixtureToInput)), gate);
}

const GATE_FLAG = {
  type: Boolean,
  default: false,
  description:
    "Exit non-zero when the judge drops a must-keep fact, keeps too much of a gold trim, or slop recall falls under the floor",
} as const;

if (import.meta.main) {
  // cleye runs one handler synchronously, either a command's or the root's, so
  // the handler parks its work here for the top-level await below. `--help`
  // parks nothing and exits 0.
  let task: Promise<number> | undefined;

  const buildCmd = command(
    {
      name: "build",
      flags: {
        jobBase: { type: String, default: EVAL_JOB_BASE, description: "Where the job dir lands" },
      },
    },
    (parsed) => {
      task = build(parsed.flags.jobBase);
    },
  );

  const scoreCmd = command(
    {
      name: "score",
      flags: {
        job: { type: String, description: "The job dir printed by build" },
        gate: GATE_FLAG,
      },
    },
    (parsed) => {
      task = score(parsed.flags.job, parsed.flags.gate);
    },
  );

  await cli(
    {
      name: "eval",
      flags: {
        model: { type: String, default: JUDGE_MODEL, description: "Judge model id" },
        gate: GATE_FLAG,
      },
      commands: [buildCmd, scoreCmd],
    },
    (parsed) => {
      task = oracle(parsed.flags.model, parsed.flags.gate);
    },
  );

  process.exit(
    await (task?.catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }) ?? 0),
  );
}
