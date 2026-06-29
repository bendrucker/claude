#!/usr/bin/env bun

import { join } from "node:path";
import { Glob } from "bun";
import { cli } from "cleye";
import { table } from "table";
import type { CommentKind, Language } from "../detection/types";
import { loadPrompt } from "../judge/judge";
import { SLOP_CATEGORIES, type SlopCategory, type Verdict } from "../judge/schema";
import {
  anthropicCommentJudge,
  type CommentJudge,
  type CommentJudgeInput,
  JUDGE_MODEL,
  judgeComments,
} from "./oracle";

/**
 * One labeled comment with the surrounding context the judge sees. `label`
 * partitions the corpus: `slop` must be flagged, `ok` is a must-pass negative
 * the judge must never flag. The `ok` set is the ship gate.
 */
export interface Fixture {
  id: string;
  path: string;
  language: Language;
  kind: CommentKind;
  comment: string;
  context: string;
  label: "slop" | "ok";
  category: SlopCategory | null;
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
  const label = record.label;
  if (label !== "slop" && label !== "ok") {
    throw new Error(`Fixture ${file} has invalid label ${JSON.stringify(label)}`);
  }
  const category = record.category ?? null;
  if (label === "ok" && category !== null) {
    throw new Error(`Fixture ${file} is "ok" but carries a category`);
  }
  if (label === "slop" && !SLOP_CATEGORIES.includes(category as SlopCategory)) {
    throw new Error(`Fixture ${file} has invalid slop category ${JSON.stringify(category)}`);
  }
  for (const key of ["id", "path", "language", "kind", "comment", "context"]) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
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
    label,
    category: category as SlopCategory | null,
  };
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

export interface Metrics {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  /** The must-pass-negative violations: `ok` fixtures the judge flagged. */
  falsePositiveIds: string[];
  /** `slop` fixtures the judge missed. */
  falseNegativeIds: string[];
  /** For flagged slop, how often the predicted category matched the label. */
  categoryMatches: number;
}

/**
 * Pure scorer over aligned fixtures and verdicts. A `slop` fixture is a positive;
 * a flag (`isSlop`) is a predicted positive. Precision and recall are computed on
 * the slop class. Division by zero yields 1 (nothing to get wrong).
 */
export function scoreResults(fixtures: Fixture[], verdicts: Verdict[]): Metrics {
  if (fixtures.length !== verdicts.length) {
    throw new Error(`Scored ${verdicts.length} verdicts against ${fixtures.length} fixtures`);
  }
  const metrics: Metrics = {
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
    falsePositiveIds: [],
    falseNegativeIds: [],
    categoryMatches: 0,
  };
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    const isSlop = fixture.label === "slop";
    if (isSlop && verdict.isSlop) {
      metrics.truePositives++;
      if (verdict.category === fixture.category) metrics.categoryMatches++;
    } else if (isSlop && !verdict.isSlop) {
      metrics.falseNegatives++;
      metrics.falseNegativeIds.push(fixture.id);
    } else if (!isSlop && verdict.isSlop) {
      metrics.falsePositives++;
      metrics.falsePositiveIds.push(fixture.id);
    } else {
      metrics.trueNegatives++;
    }
  }
  const predictedPositives = metrics.truePositives + metrics.falsePositives;
  const actualPositives = metrics.truePositives + metrics.falseNegatives;
  metrics.precision = predictedPositives === 0 ? 1 : metrics.truePositives / predictedPositives;
  metrics.recall = actualPositives === 0 ? 1 : metrics.truePositives / actualPositives;
  return metrics;
}

function report(fixtures: Fixture[], verdicts: Verdict[], metrics: Metrics): string {
  const rows: string[][] = [["id", "label", "expected", "predicted", "category", "ok"]];
  for (const [i, fixture] of fixtures.entries()) {
    const verdict = verdicts[i];
    if (!verdict) continue;
    const correct = (fixture.label === "slop") === verdict.isSlop;
    rows.push([
      fixture.id,
      fixture.label,
      fixture.category ?? "-",
      verdict.isSlop ? "slop" : "ok",
      verdict.category ?? "-",
      correct ? "y" : "N",
    ]);
  }
  const summary = [
    `precision ${metrics.precision.toFixed(2)}  recall ${metrics.recall.toFixed(2)}`,
    `TP ${metrics.truePositives}  FP ${metrics.falsePositives}  TN ${metrics.trueNegatives}  FN ${metrics.falseNegatives}`,
    `category matches ${metrics.categoryMatches}/${metrics.truePositives}`,
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
  if (gate && metrics.falsePositives > 0) {
    console.error(
      `\nSHIP GATE FAILED: judge flagged ${metrics.falsePositives} must-pass comment(s): ${metrics.falsePositiveIds.join(", ")}`,
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
        description: "Exit non-zero on any must-pass false positive",
      },
    },
  });
  const prompt = await loadPrompt();
  console.error(`Judging fixtures on ${argv.flags.model} (prompt ${prompt.sha256.slice(0, 12)})`);
  const judge = anthropicCommentJudge({ prompt: prompt.text, model: argv.flags.model });
  process.exit(await run(judge, argv.flags.gate));
}
