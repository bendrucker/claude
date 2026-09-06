#!/usr/bin/env bun

import { tmpdir } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";
import { collectVerdicts } from "../apply/join";
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
 * partitions the corpus: `keep` is a must-pass negative the judge must never
 * trim or rewrite, `trim` must be trimmed, `rewrite` must be rewritten. The
 * `keep` set is the ship gate: trimming a justified comment is destructive.
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
  trimToLines?: number[];
  /** Absent fixtures are judged as agent-written, the rubric's default. */
  provenance?: Provenance;
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
      trimToLines: z.array(z.number()).nullish(),
      provenance: ProvenanceSchema.nullish(),
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
  });

function validateFixture(value: unknown, file: string): Fixture {
  const parsed = FixtureInput.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Fixture ${file} ${parsed.error.issues[0]?.message}`);
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
  if (decoded.trimToLines != null) fixture.trimToLines = decoded.trimToLines;
  if (decoded.provenance != null) fixture.provenance = decoded.provenance;
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
  };
}

export interface ActionMismatch {
  id: string;
  expected: VerdictAction;
  predicted: VerdictAction;
}

export interface Metrics {
  total: number;
  /** Fixtures whose predicted action matched the label. */
  correct: number;
  /** correct / total, the action-accuracy gate. 1 when there is nothing to score. */
  accuracy: number;
  /** Every fixture whose predicted action differed from the label. */
  mismatches: ActionMismatch[];
  /** Destructive subset: `keep` fixtures the judge trimmed or rewrote. The ship gate. */
  keepViolations: string[];
  /** For correctly actioned `trim`/`rewrite`, how often the category also matched. */
  categoryMatches: number;
}

/**
 * Pure scorer over aligned fixtures and verdicts, on a three-action basis. A
 * fixture is correct when the predicted action equals its label. `keepViolations`
 * isolate the destructive errors: a `keep` comment the judge trimmed or rewrote.
 * An empty corpus yields accuracy 1 (nothing to get wrong).
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
  };
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    metrics.total++;
    if (verdict.action === fixture.action) {
      metrics.correct++;
      if (fixture.action !== "keep" && verdict.category === fixture.category) {
        metrics.categoryMatches++;
      }
    } else {
      metrics.mismatches.push({
        id: fixture.id,
        expected: fixture.action,
        predicted: verdict.action,
      });
      if (fixture.action === "keep") metrics.keepViolations.push(fixture.id);
    }
  }
  metrics.accuracy = metrics.total === 0 ? 1 : metrics.correct / metrics.total;
  return metrics;
}

function report(fixtures: Fixture[], verdicts: Verdict[], metrics: Metrics): string {
  const rows: string[][] = [["id", "expected", "predicted", "category", "ok"]];
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    const correct = verdict.action === fixture.action;
    rows.push([
      fixture.id,
      fixture.action,
      verdict.action,
      verdict.category ?? "-",
      correct ? "y" : "N",
    ]);
  }
  const summary = [
    `accuracy ${metrics.accuracy.toFixed(2)}  (${metrics.correct}/${metrics.total})`,
    `keep violations ${metrics.keepViolations.length}`,
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
  if (unjudged.length > 0) {
    throw new Error(`No verdict for ${unjudged.length} fixture(s): ${unjudged.join(", ")}`);
  }
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  const foreign = [...verdicts.keys()].filter((id) => !ids.has(id));
  if (foreign.length > 0) {
    throw new Error(`Verdicts name ${foreign.length} unknown comment(s): ${foreign.join(", ")}`);
  }
  return aligned;
}

/** Where `build` materializes a job, kept apart from the audit's own job dirs. */
const EVAL_JOB_BASE = join(tmpdir(), "comments-eval");

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
  const glob = new Glob("verdict-*.json");
  const contents: unknown[] = [];
  for await (const file of glob.scan(verdictsDir)) {
    contents.push(JSON.parse(await Bun.file(join(verdictsDir, file)).text()));
  }
  if (contents.length === 0) {
    throw new Error(`No verdict files in ${verdictsDir}. Run the judge workflow first.`);
  }
  return collectVerdicts(contents);
}

function gateOn(fixtures: Fixture[], verdicts: Verdict[], gate: boolean): number {
  const metrics = scoreResults(fixtures, verdicts);
  console.log(report(fixtures, verdicts, metrics));
  if (gate && metrics.keepViolations.length > 0) {
    console.error(
      `\nSHIP GATE FAILED: judge did not keep ${metrics.keepViolations.length} must-keep comment(s): ${metrics.keepViolations.join(", ")}`,
    );
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
  description: "Exit non-zero when the judge trims or rewrites a must-keep comment",
} as const;

if (import.meta.main) {
  // cleye dispatches synchronously, so each handler parks its work here for the
  // top-level await below. `--help` parks nothing and exits 0.
  const tasks: Promise<number>[] = [];

  const buildCmd = command(
    {
      name: "build",
      flags: {
        jobBase: { type: String, default: EVAL_JOB_BASE, description: "Where the job dir lands" },
      },
    },
    (parsed) => {
      tasks.push(build(parsed.flags.jobBase));
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
      tasks.push(score(parsed.flags.job, parsed.flags.gate));
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
      tasks.push(oracle(parsed.flags.model, parsed.flags.gate));
    },
  );

  const codes = await Promise.all(
    tasks.map((task) =>
      task.catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      }),
    ),
  );
  process.exit(codes.find((code) => code !== 0) ?? 0);
}
