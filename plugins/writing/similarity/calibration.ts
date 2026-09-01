// A calibration curve turns a raw margin into "where this sits in my own
// writing". It is stored as a 101-entry ladder, one value per whole percentile
// of the voice corpus's own score distribution, so a lookup is a binary search
// with no need to ship the sample.

import { z } from "zod";
import { quantileOfSorted } from "./vector";

export const LADDER_SIZE = 101;

export const Calibration = z.object({
  sampleSize: z.number(),
  // Ascending. Index i is the i-th percentile of the voice distribution.
  ladder: z.array(z.number()).length(LADDER_SIZE),
});
export type Calibration = z.infer<typeof Calibration>;

export function calibrate(sample: number[]): Calibration {
  const sorted = sample.toSorted((a, b) => a - b);
  const ladder: number[] = [];
  for (let percentile = 0; percentile < LADDER_SIZE; percentile++) {
    ladder.push(quantileOfSorted(sorted, percentile / (LADDER_SIZE - 1)));
  }
  return { sampleSize: sample.length, ladder };
}

// Percentile of a score against the ladder, interpolated between rungs so two
// nearby scores do not collapse onto the same whole percentile.
export function percentileOf(calibration: Calibration, score: number): number {
  const { ladder } = calibration;
  const first = ladder[0] ?? 0;
  const last = ladder[LADDER_SIZE - 1] ?? 0;
  if (score <= first) return 0;
  if (score >= last) return 100;
  let low = 0;
  let high = LADDER_SIZE - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if ((ladder[mid] ?? 0) <= score) low = mid;
    else high = mid;
  }
  const lowValue = ladder[low] ?? 0;
  const highValue = ladder[high] ?? 0;
  if (highValue === lowValue) return low;
  return low + (score - lowValue) / (highValue - lowValue);
}
