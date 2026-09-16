/**
 * Action rates per comment shape, measured from the runs already on disk. Every
 * preflight writes a `features.json` beside the verdicts its judges produce, so
 * the job base accumulates (features, verdict) pairs across runs. Reading them
 * back turns the descriptive features into a measured prior on which shapes the
 * judge acts on, which is what ranks the next run's shards.
 *
 * Reads are tolerant. A partial, abandoned, or older-format job dir is skipped
 * rather than failing a run whose real work is judging this change's comments.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CommentFeatures } from "./features";

/** Shapes with a measurable rate. Size already drives the score, so these are what it misses. */
export const SHAPES = ["divider-rule", "ticket-id", "why-marker", "code-aligned"] as const;
export type Shape = (typeof SHAPES)[number];

/** Alignment at or above which a comment's content words mostly echo the adjacent identifiers. */
const HIGH_ALIGNMENT = 0.5;

/** The fields a shape reads, so a features row missing the rest still classifies. */
type ShapeFeatures = Pick<
  CommentFeatures,
  "codeAlignment" | "whyMarker" | "ticketId" | "dividerRule"
>;

export function commentShapes(features: ShapeFeatures): Shape[] {
  const shapes: Shape[] = [];
  if (features.dividerRule) shapes.push("divider-rule");
  if (features.ticketId) shapes.push("ticket-id");
  if (features.whyMarker) shapes.push("why-marker");
  if (features.codeAlignment >= HIGH_ALIGNMENT) shapes.push("code-aligned");
  return shapes;
}

// Only the fields the rate needs. A schema mirroring CommentFeatures would
// reject a job dir written before a field existed, losing its pairs.
const FeatureRow = z.looseObject({
  codeAlignment: z.number().default(0),
  whyMarker: z.boolean().default(false),
  ticketId: z.boolean().default(false),
  dividerRule: z.boolean().default(false),
});

const FeaturesFile = z.record(z.string(), FeatureRow);

const VerdictsFile = z.looseObject({
  verdicts: z.array(
    z.looseObject({ id: z.string(), verdict: z.looseObject({ action: z.string() }) }),
  ),
});

export interface ShapeRate {
  shape: Shape;
  judged: number;
  /** Judged comments the judge did something to, so `trim` and `rewrite` alike. */
  actioned: number;
}

export interface AuditHistory {
  /** Job dirs that yielded at least one pair. */
  runs: number;
  judged: number;
  actioned: number;
  shapes: ShapeRate[];
}

export const EMPTY_HISTORY: AuditHistory = { runs: 0, judged: 0, actioned: 0, shapes: [] };

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const parsed = schema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

async function readRun(jobDir: string): Promise<{ shapes: Shape[]; actioned: boolean }[]> {
  const features = await readJson(join(jobDir, "features.json"), FeaturesFile);
  if (features === null) return [];
  const verdictsDir = join(jobDir, "verdicts");
  const names = await readdir(verdictsDir).catch(() => []);
  const files = await Promise.all(
    names.map((name) => readJson(join(verdictsDir, name), VerdictsFile)),
  );

  const pairs: { shapes: Shape[]; actioned: boolean }[] = [];
  for (const file of files) {
    for (const entry of file?.verdicts ?? []) {
      const row = features[entry.id];
      if (row === undefined) continue;
      pairs.push({
        shapes: commentShapes(row),
        actioned: entry.verdict.action !== "keep",
      });
    }
  }
  return pairs;
}

export async function readHistory(jobBase: string): Promise<AuditHistory> {
  const dirs = await readdir(jobBase).catch(() => []);
  const runs = await Promise.all(dirs.map((dir) => readRun(join(jobBase, dir))));

  const counts = new Map<Shape, ShapeRate>(
    SHAPES.map((shape) => [shape, { shape, judged: 0, actioned: 0 }]),
  );
  const history: AuditHistory = { runs: 0, judged: 0, actioned: 0, shapes: [] };
  for (const pairs of runs) {
    if (pairs.length === 0) continue;
    history.runs += 1;
    for (const pair of pairs) {
      history.judged += 1;
      if (pair.actioned) history.actioned += 1;
      for (const shape of pair.shapes) {
        const rate = counts.get(shape);
        if (rate === undefined) continue;
        rate.judged += 1;
        if (pair.actioned) rate.actioned += 1;
      }
    }
  }
  history.shapes = [...counts.values()].filter((rate) => rate.judged > 0);
  return history;
}

/**
 * Pairs a shape needs before its rate steers the ranking. A rate over twenty-odd
 * comments moves by more than the lift it would report, so a smaller sample
 * would rank on which way a handful of judgments fell.
 */
export const MIN_JUDGED = 30;

// Bounded like the density weights, so one shape's rate cannot swamp the file
// signal or push a short comment past a long one on its own.
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 2;

/**
 * Multiplier per shape: its action rate over the rate across every judged
 * comment. Shapes with too few pairs are omitted and weigh nothing.
 */
export function shapeWeights(history: AuditHistory): Map<Shape, number> {
  const weights = new Map<Shape, number>();
  if (history.judged === 0 || history.actioned === 0) return weights;
  const overall = history.actioned / history.judged;
  for (const rate of history.shapes) {
    if (rate.judged < MIN_JUDGED) continue;
    const lift = rate.actioned / rate.judged / overall;
    weights.set(rate.shape, Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, lift)));
  }
  return weights;
}

/**
 * How much a comment's shapes move it in the ranking. The mean over its matched
 * shapes, so a shape the judge keeps offsets one it acts on, and 1 for a comment
 * carrying no shape with a measured rate.
 */
export function shapeWeight(
  features: ShapeFeatures,
  weights: ReadonlyMap<Shape, number>,
): number {
  const matched = commentShapes(features)
    .map((shape) => weights.get(shape))
    .filter((weight) => weight !== undefined);
  if (matched.length === 0) return 1;
  return matched.reduce((sum, weight) => sum + weight, 0) / matched.length;
}
