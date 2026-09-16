// The measurements the analyze reports take against the local corpora and the
// hook run log, persisted so the scan surfaces can read a verdict instead of
// printing every number as if it were equally meaningful. The corpora are
// local-only, so every section is optional and every consumer must render
// unchanged when the file is absent.

import { z } from "zod";

/**
 * One voice-delta rate feature's observed corpus gap beside the gap a split of
 * the baseline against itself reaches on its own.
 */
export const RateFloor = z.object({
  featureId: z.string(),
  /** Observed |corpus A mean - corpus B mean|. */
  gap: z.number(),
  /** The permutation null, or null where the baseline was too small to split. */
  floor: z.number().nullable(),
});
export type RateFloor = z.infer<typeof RateFloor>;

export const RateNullRun = z.object({
  splits: z.number(),
  percentile: z.number(),
  seed: z.number(),
  /** The length band both corpora were restricted to. Null on both ends is the full corpus. */
  minWords: z.number().nullable(),
  maxWords: z.number().nullable(),
  floors: z.array(RateFloor),
});
export type RateNullRun = z.infer<typeof RateNullRun>;

/**
 * One run per length band. The agent corpus averages several times the document
 * length of the baseline, so a feature that varies with length clears the
 * full-corpus floor on that difference alone. Restricting both corpora to one
 * band separates the two, and a feature earns its delta only by clearing every
 * band measured.
 */
export const RateNulls = z.object({ runs: z.array(RateNullRun) });
export type RateNulls = z.infer<typeof RateNulls>;

export function describeRun(run: RateNullRun): string {
  if (run.minWords === null && run.maxWords === null) return "full corpus";
  return `${run.minWords ?? 0}-${run.maxWords ?? "∞"} word band`;
}

/** Two runs measure the same thing when they cover the same length band. */
export function sameBand(a: RateNullRun, b: RateNullRun): boolean {
  return a.minWords === b.minWords && a.maxWords === b.maxWords;
}

export const TagShape = z.object({
  /** Space-joined coarse tag sequence, as tag-signatures ranks it. */
  shape: z.string(),
  n: z.number(),
  z: z.number(),
});
export type TagShape = z.infer<typeof TagShape>;

export const TagSignatures = z.object({
  sizes: z.array(z.number()),
  /**
   * Share of each corpus's tag n-grams that land on a confirmed signature.
   * A document's own share reads against these two poles, which is the only
   * honest reading: one shape in one document decides nothing.
   */
  studyShare: z.number(),
  baselineShare: z.number(),
  shapes: z.array(TagShape),
});
export type TagSignatures = z.infer<typeof TagSignatures>;

export const CategoryAcceptance = z.object({
  category: z.string(),
  fired: z.number(),
  /** Shown findings a later whole-file re-scan of the same file reached. */
  revisited: z.number(),
  /** Revisited findings the re-scan no longer raised. */
  accepted: z.number(),
});
export type CategoryAcceptance = z.infer<typeof CategoryAcceptance>;

export const HookAcceptance = z.object({
  runs: z.number(),
  spanDays: z.number(),
  categories: z.array(CategoryAcceptance),
});
export type HookAcceptance = z.infer<typeof HookAcceptance>;

export const WritingStatistics = z.object({
  generatedAt: z.string(),
  rateNulls: RateNulls.optional(),
  tagSignatures: TagSignatures.optional(),
  hookHealth: HookAcceptance.optional(),
});
export type WritingStatistics = z.infer<typeof WritingStatistics>;

export async function loadStatistics(path: string): Promise<WritingStatistics | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return WritingStatistics.parse(await file.json());
}

/** An unfloored feature stays, since an absent floor means the null never ran. */
export function clearsFloor(rate: RateFloor): boolean {
  return rate.floor === null || rate.gap > rate.floor;
}

/** The bands whose null a feature's corpus gap failed to clear, empty when it cleared every one. */
export function failedBands(statistics: WritingStatistics | null, featureId: string): string[] {
  const failed: string[] = [];
  for (const run of statistics?.rateNulls?.runs ?? []) {
    const floor = run.floors.find((rate) => rate.featureId === featureId);
    if (floor !== undefined && !clearsFloor(floor)) failed.push(describeRun(run));
  }
  return failed;
}

/** Whether any run measured this feature at all, which decides between a verdict and a blank. */
export function measuredFeature(statistics: WritingStatistics | null, featureId: string): boolean {
  return (statistics?.rateNulls?.runs ?? []).some((run) =>
    run.floors.some((rate) => rate.featureId === featureId),
  );
}

// hook-health gates its own advice on evidence sufficiency for the same reason:
// a rate over a handful of findings tracks whichever way the handful fell.
const MIN_REVISITS = 20;

/**
 * Share of a category's shown findings that a later re-scan no longer raised.
 * Null where too few findings were revisited for the rate to mean anything.
 */
export function acceptedShare(category: CategoryAcceptance): number | null {
  if (category.revisited < MIN_REVISITS) return null;
  return category.accepted / category.revisited;
}

export function acceptanceByCategory(
  statistics: WritingStatistics | null,
): Map<string, CategoryAcceptance> {
  return new Map(
    (statistics?.hookHealth?.categories ?? []).map((category) => [category.category, category]),
  );
}
