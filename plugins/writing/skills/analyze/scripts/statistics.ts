// Every section is optional, since the corpora are local-only, and every
// consumer must render unchanged when the file is absent.

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
 * One run per length band, so a feature earns its delta only after clearing
 * every band rather than merely tracking the agent corpus's longer documents.
 */
export const RateNulls = z.object({ runs: z.array(RateNullRun) });
export type RateNulls = z.infer<typeof RateNulls>;

export function describeRunMethod(run: RateNullRun): string {
  return `${describeBand(run)} (${run.splits} splits at the ${run.percentile}th percentile)`;
}

interface Band {
  minWords: number | null;
  maxWords: number | null;
}

export function sameBand(a: Band, b: Band): boolean {
  return a.minWords === b.minWords && a.maxWords === b.maxWords;
}

export function describeBand(band: Band): string {
  if (band.minWords === null && band.maxWords === null) return "full corpus";
  return `${band.minWords ?? 0}-${band.maxWords ?? "∞"} word band`;
}

function bandWidth(band: Band): number {
  return (band.maxWords ?? Number.POSITIVE_INFINITY) - (band.minWords ?? 0);
}

/** Widest band first, so the full corpus leads the runs a report prints. */
export function byBand(a: Band, b: Band): number {
  const widths = bandWidth(b) - bandWidth(a);
  // Two open-ended bands both measure infinitely wide, and subtracting those
  // yields NaN, which sorts as a tie and leaves the order to whatever the merge
  // happened to append last. The one starting lower contains the other.
  if (widths !== 0 && !Number.isNaN(widths)) return widths;
  return (a.minWords ?? 0) - (b.minWords ?? 0);
}

export const TagShape = z.object({
  /** Space-joined coarse tag sequence. */
  shape: z.string(),
  n: z.number(),
  z: z.number(),
});
export type TagShape = z.infer<typeof TagShape>;

export const TagSignatures = z.object({
  sizes: z.array(z.number()),
  /**
   * The length band both corpora were held to, since the shares below describe
   * only the documents inside it. A banded build replaces an unbanded one, so a
   * reader that ignored this would compare every document against a slice.
   */
  minWords: z.number().nullable().default(null),
  maxWords: z.number().nullable().default(null),
  /**
   * Share of each corpus's tag n-grams landing on a confirmed signature. A
   * document's own share reads against these two poles: one shape in one
   * document decides nothing.
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

/**
 * The artifact, or null where it is absent or unreadable. A torn write is the
 * same answer as no file: `build-statistics.ts` writes it in place while a scan
 * may be reading, and a scan whose real work is finding tropes must not die on
 * the statistics it only annotates with.
 */
export async function loadStatistics(path: string): Promise<WritingStatistics | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const parsed = WritingStatistics.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : null;
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
    if (floor !== undefined && !clearsFloor(floor)) failed.push(describeBand(run));
  }
  return failed;
}

export function measuredFeature(statistics: WritingStatistics | null, featureId: string): boolean {
  return (statistics?.rateNulls?.runs ?? []).some((run) =>
    run.floors.some((rate) => rate.featureId === featureId),
  );
}

// A rate over a handful of revisited findings tracks whichever way the handful
// fell.
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
