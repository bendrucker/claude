#!/usr/bin/env bun

import { join } from "node:path";
import { Glob } from "bun";
import { cli } from "cleye";
import { table } from "table";
import type { CommentKind, Language } from "../detection/types";
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
  type CommentJudge,
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
  source?: string;
  note?: string;
}

export const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

export async function loadFixtures(dir: string = FIXTURES_DIR): Promise<Fixture[]> {
  const glob = new Glob("*.json");
  const fixtures: Fixture[] = [];
  for await (const file of glob.scan(dir)) {
    const parsed = JSON.parse(await Bun.file(join(dir, file)).text());
    fixtures.push(validateFixture(parsed, file));
  }
  fixtures.sort((a, b) => a.id.localeCompare(b.id));
  return fixtures;
}

function validateFixture(value: unknown, file: string): Fixture {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Fixture ${file} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string" || !VERDICT_ACTIONS.includes(action as VerdictAction)) {
    throw new Error(`Fixture ${file} has invalid action ${JSON.stringify(action)}`);
  }
  const category = record.category ?? null;
  if (action === "keep" && category !== null) {
    throw new Error(`Fixture ${file} is "keep" but carries a category`);
  }
  if (action !== "keep" && !SLOP_CATEGORIES.includes(category as SlopCategory)) {
    throw new Error(`Fixture ${file} has invalid slop category ${JSON.stringify(category)}`);
  }
  if (action === "rewrite" && (typeof record.rewrite !== "string" || record.rewrite.length === 0)) {
    throw new Error(`Fixture ${file} is "rewrite" but carries no gold rewrite text`);
  }
  for (const key of ["id", "path", "language", "kind", "comment", "context"]) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new Error(`Fixture ${file} missing required string "${key}"`);
    }
  }
  const fixture: Fixture = {
    id: record.id as string,
    path: record.path as string,
    language: record.language as Language,
    kind: record.kind as CommentKind,
    comment: record.comment as string,
    context: record.context as string,
    action: action as VerdictAction,
    category: category as SlopCategory | null,
  };
  if (record.trimTo != null) {
    if (typeof record.trimTo !== "string" || record.trimTo.length === 0 || action !== "trim") {
      throw new Error(`Fixture ${file} "trimTo" must be a non-empty string on a "trim" fixture`);
    }
    fixture.trimTo = record.trimTo;
  }
  if (typeof record.rewrite === "string") fixture.rewrite = record.rewrite;
  if (Array.isArray(record.trimToLines)) fixture.trimToLines = record.trimToLines as number[];
  if (typeof record.source === "string") fixture.source = record.source;
  if (typeof record.note === "string") fixture.note = record.note;
  return fixture;
}

export function fixtureToInput(fixture: Fixture): CommentJudgeInput {
  return {
    path: fixture.path,
    language: fixture.language,
    kind: fixture.kind,
    text: fixture.comment,
    context: fixture.context,
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

async function run(judge: CommentJudge, gate: boolean): Promise<number> {
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found.");
    return 1;
  }
  const verdicts = await judgeComments(judge, fixtures.map(fixtureToInput));
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

if (import.meta.main) {
  const argv = cli({
    name: "eval",
    flags: {
      model: { type: String, default: JUDGE_MODEL, description: "Judge model id" },
      gate: {
        type: Boolean,
        default: false,
        description: "Exit non-zero when the judge trims or rewrites a must-keep comment",
      },
    },
  });
  const prompt = await loadPrompt();
  console.error(`Judging fixtures on ${argv.flags.model} (prompt ${prompt.sha256.slice(0, 12)})`);
  const judge = anthropicCommentJudge({ prompt: prompt.text, model: argv.flags.model });
  process.exit(await run(judge, argv.flags.gate));
}
