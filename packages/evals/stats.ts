import seedrandom from "seedrandom";
import { mean, permutationTest } from "simple-statistics";

const TRIALS = 10_000;

/** A Monte Carlo p-value counting the observed statistic as one permutation, so it never reaches 0. */
const corrected = (extreme: number) => (extreme + 1) / (TRIALS + 1);

/** Two-sided permutation p-value between two samples, seeded so a report reprints the same. */
export function pValue(base: number[], other: number[]): number {
  if (base.length === 0 || other.length === 0) return NaN;
  if (new Set([...base, ...other]).size === 1) return 1;
  const share = permutationTest(base, other, "two_side", TRIALS, seedrandom("compare"));
  return corrected(share * TRIALS);
}

/**
 * The smallest p-value a permutation test can return for these sample sizes: one or two of the
 * C(n1 + n2, n1) splits, since equal sizes put the two extremes at the same distance.
 */
export function pFloor(n1: number, n2: number): number {
  let splits = 1;
  for (let i = 1; i <= Math.min(n1, n2); i++) splits = (splits * (n1 + n2 - i + 1)) / i;
  return (n1 === n2 ? 2 : 1) / splits;
}

/**
 * Two-sided sign-flip permutation p-value for paired differences against a null of zero, NaN
 * when every difference is zero. A win rate tests as `wins - 0.5`.
 */
export function signFlipPValue(
  diffs: readonly number[],
  rng: () => number = seedrandom("compare"),
): number {
  const live = diffs.filter((d) => d !== 0);
  if (live.length === 0) return Number.NaN;
  const observed = Math.abs(mean(live));
  let extreme = 0;
  for (let t = 0; t < TRIALS; t++) {
    let sum = 0;
    for (const d of live) sum += rng() < 0.5 ? d : -d;
    if (Math.abs(sum / live.length) >= observed - 1e-9) extreme++;
  }
  return corrected(extreme);
}

/**
 * Wilson score interval for a proportion, 95% at the default `z`. A rate measured on a handful
 * of hits gets a visibly wide interval instead of a number that reads as settled.
 */
export function wilson(hits: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = hits / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const spread =
    (z / denominator) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}
