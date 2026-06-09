/**
 * Sample-size math for the detector eval (issue #769). The eval promotes a
 * classifier only when its measured precision is distinguishable from the
 * baseline's, and that precision is measured over the classifier's positive
 * (flagged) labels: `wilson(tp, tp + fp)`. The heading pilot had ~24 positive
 * flags in the random subset, giving a ±~19pp interval, too wide to separate
 * candidates. These helpers compute how many positive labels tighten that
 * interval to a target lift, and how large a uniform-random labeling pass must
 * be to yield them at a given flag rate.
 *
 * The interval is the normal approximation to the Wilson interval used in
 * `headings-eval.ts`: at precision p over n positives the 95% half-width is
 * z * sqrt(p(1-p)/n). Two classifiers a target lift `delta` apart are
 * distinguishable when their intervals stop overlapping, i.e. each half-width
 * is at most delta/2. The required positive count follows by solving for n.
 */

/** z for a two-sided 95% interval, matching `wilson()` in the harness. */
const Z_95 = 1.96;

/** p(1-p) is maximal at 0.5; the worst-case (widest) interval per n. */
const WORST_CASE_PRECISION = 0.5;

export interface PowerInputs {
  /** Target detectable lift in percentage points (e.g. 10 for 10pp). */
  targetLiftPP: number;
  /**
   * Precision the interval is sized at. The interval is widest at 0.5, so the
   * default is the conservative worst case. Pass a measured precision to size
   * for a specific operating point.
   */
  precision?: number;
  /** Confidence z-score; defaults to the harness's 95% value. */
  z?: number;
}

export interface PowerResult {
  /** Half-width budget per interval: delta/2 as a proportion. */
  marginBudget: number;
  /** Precision the sizing assumed. */
  precision: number;
  /**
   * Positive (flagged) labels needed for the precision interval to fit the
   * budget. This is the denominator of `wilson(tp, tp + fp)`.
   */
  requiredPositives: number;
}

/**
 * Required positive-label count to detect `targetLiftPP` at the given
 * confidence. Solves z*sqrt(p(1-p)/n) <= (delta/2) for n, where p is the
 * precision (default worst case 0.5) and delta the lift as a proportion.
 */
export function requiredPositiveCount(inputs: PowerInputs): PowerResult {
  const { targetLiftPP } = inputs;
  const precision = inputs.precision ?? WORST_CASE_PRECISION;
  const z = inputs.z ?? Z_95;
  if (precision < 0 || precision > 1) {
    throw new Error(`precision must be in [0, 1], got ${precision}`);
  }
  if (targetLiftPP <= 0 || targetLiftPP > 100) {
    throw new Error(`targetLiftPP must be in (0, 100], got ${targetLiftPP}`);
  }

  const marginBudget = targetLiftPP / 100 / 2;
  const variance = precision * (1 - precision);
  const requiredPositives = Math.ceil((z ** 2 * variance) / marginBudget ** 2);

  return { marginBudget, precision, requiredPositives };
}

export interface CurrentSample {
  /** Positive (flagged) labels in the current sample. */
  positives: number;
  /** Total labeled rows in the current sample. */
  total: number;
}

export interface PowerComparison extends PowerResult {
  /** Flag rate of the current sample (positives / total). */
  flagRate: number;
  /**
   * Uniform-random labels needed to yield `requiredPositives` at the current
   * flag rate. Active labeling on disagreements raises the realized rate, so
   * this is an upper bound on the labeling work.
   */
  requiredSamples: number;
  /** How many more positive labels are needed beyond the current sample. */
  additionalPositives: number;
  /** Required positives as a multiple of the current positive count. */
  positiveMultiple: number;
}

/**
 * Size the labeling work against a current sample. The flag rate is taken from
 * the current sample, so `requiredSamples` answers "how large a uniform-random
 * pass yields enough positives to detect `targetLiftPP`?" Pass a measured
 * `precision` to size at a specific operating point instead of the worst case.
 */
export function powerFromCurrentSample(
  current: CurrentSample,
  targetLiftPP: number,
  options: { precision?: number; z?: number } = {},
): PowerComparison {
  if (current.total <= 0) throw new Error("current sample total must be positive");
  if (current.positives <= 0) throw new Error("current sample must have at least one positive");
  const result = requiredPositiveCount({ targetLiftPP, ...options });
  const flagRate = current.positives / current.total;
  return {
    ...result,
    flagRate,
    requiredSamples: Math.ceil(result.requiredPositives / flagRate),
    additionalPositives: Math.max(0, result.requiredPositives - current.positives),
    positiveMultiple: result.requiredPositives / current.positives,
  };
}
