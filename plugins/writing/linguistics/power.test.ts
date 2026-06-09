import { describe, expect, it } from "bun:test";
import { powerFromCurrentSample, requiredPositiveCount } from "./power";

describe("requiredPositiveCount", () => {
  it("solves z*sqrt(p(1-p)/n) <= delta/2 for n at the worst-case precision", () => {
    // p=0.5, delta=10pp -> budget 0.05, n = ceil(1.96^2 * 0.25 / 0.05^2)
    const { marginBudget, precision, requiredPositives } = requiredPositiveCount({
      targetLiftPP: 10,
    });
    expect(marginBudget).toBeCloseTo(0.05, 10);
    expect(precision).toBe(0.5);
    expect(requiredPositives).toBe(Math.ceil((1.96 ** 2 * 0.25) / 0.05 ** 2));
    expect(requiredPositives).toBe(385);
  });

  it("needs fewer positives for a wider target lift", () => {
    const tight = requiredPositiveCount({ targetLiftPP: 5 });
    const loose = requiredPositiveCount({ targetLiftPP: 20 });
    expect(loose.requiredPositives).toBeLessThan(tight.requiredPositives);
  });

  it("needs fewer positives away from the worst-case precision", () => {
    const worst = requiredPositiveCount({ targetLiftPP: 10, precision: 0.5 });
    const skewed = requiredPositiveCount({ targetLiftPP: 10, precision: 0.9 });
    // p(1-p) is maximal at 0.5, so a high-precision operating point is cheaper.
    expect(skewed.requiredPositives).toBeLessThan(worst.requiredPositives);
  });

  it("respects a custom confidence z", () => {
    const wide = requiredPositiveCount({ targetLiftPP: 10, z: 2.576 });
    const narrow = requiredPositiveCount({ targetLiftPP: 10, z: 1.96 });
    expect(wide.requiredPositives).toBeGreaterThan(narrow.requiredPositives);
  });

  it("rejects out-of-range inputs", () => {
    expect(() => requiredPositiveCount({ targetLiftPP: 10, precision: -0.1 })).toThrow("precision");
    expect(() => requiredPositiveCount({ targetLiftPP: 0 })).toThrow("targetLiftPP");
  });
});

describe("powerFromCurrentSample", () => {
  it("derives the flag rate from the current sample and reports the multiple", () => {
    const result = powerFromCurrentSample({ positives: 24, total: 499 }, 10);
    expect(result.flagRate).toBeCloseTo(24 / 499, 10);
    expect(result.requiredPositives).toBe(385);
    expect(result.positiveMultiple).toBeCloseTo(385 / 24, 10);
    expect(result.additionalPositives).toBe(385 - 24);
    // Uniform-random rows to yield the positives at the current flag rate.
    expect(result.requiredSamples).toBe(Math.ceil(385 / (24 / 499)));
  });

  it("reaches the issue's 3-5x positive expectation at a lift near the current width", () => {
    // The current ~24-positive interval is ±~19pp; a ~20pp detectable target
    // lands in the issue's rough 3-5x range.
    const result = powerFromCurrentSample({ positives: 24, total: 499 }, 20);
    expect(result.positiveMultiple).toBeGreaterThanOrEqual(3);
    expect(result.positiveMultiple).toBeLessThanOrEqual(5);
  });

  it("reports zero additional positives when the current sample already suffices", () => {
    const result = powerFromCurrentSample({ positives: 400, total: 800 }, 10);
    expect(result.additionalPositives).toBe(0);
  });

  it("rejects an empty current sample", () => {
    expect(() => powerFromCurrentSample({ positives: 0, total: 0 }, 10)).toThrow("positive");
  });
});
