import { describe, expect, test } from "bun:test";
import {
  clearsFloor,
  type FeatureFloor,
  featureFloors,
  type FloorOptions,
  margin,
  meanOf,
  percentile,
  rateMatrix,
  renderReport,
  shuffledHalves,
} from "./rate-nulls";
import type { VoiceDocument } from "./voice-corpus";
import { VOICE_DELTA_FEATURES } from "./voice-delta";

function doc(source: string, body: string): VoiceDocument {
  return { source, meta: "", body };
}

const OPTIONS: FloorOptions = { splits: 200, percentile: 95, seed: 1 };

// Invented prose. No baseline corpus content appears in this file.
const PLAIN = "The lock timed out. I removed the retry loop. The queue drained.";
const HEAVY = "## Changes\n\n- `alpha`: one\n- `beta`: two\n\n## Testing\n\nRan it.";

function floorOf(floors: FeatureFloor[], id: string): FeatureFloor {
  const found = floors.find((floor) => floor.featureId === id);
  if (!found) throw new Error(`missing floor: ${id}`);
  return found;
}

describe("rateMatrix", () => {
  test("holds one rate per document for every feature", () => {
    const matrix = rateMatrix([doc("a", PLAIN), doc("b", HEAVY)]);
    expect(matrix.size).toBe(VOICE_DELTA_FEATURES.length);
    for (const rates of matrix.values()) expect(rates).toHaveLength(2);
  });
});

describe("meanOf", () => {
  test("averages only the named indices", () => {
    expect(meanOf([0, 10, 20, 30], [1, 3])).toBe(20);
  });

  test("returns 0 for an empty selection", () => {
    expect(meanOf([1, 2], [])).toBe(0);
  });
});

describe("shuffledHalves", () => {
  const random = (): number => 0.5;

  test("splits every index into exactly one half", () => {
    const [left, right] = shuffledHalves(8, random);
    expect([...left, ...right].toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("drops the odd document so both halves are the same size", () => {
    const [left, right] = shuffledHalves(7, random);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
  });

  test("is reproducible for one seed and divergent across seeds", () => {
    const draw = (seed: number): number[] => {
      let state = seed;
      return shuffledHalves(20, () => {
        state = (state * 16_807) % 2_147_483_647;
        return state / 2_147_483_647;
      })[0];
    };
    expect(draw(3)).toEqual(draw(3));
    expect(draw(3)).not.toEqual(draw(9));
  });
});

describe("percentile", () => {
  test("takes the value at the requested rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  test("returns 0 for no values", () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe("featureFloors", () => {
  const uniform = Array.from({ length: 40 }, (_, index) => doc(`b${index}`, PLAIN));

  test("floors a homogeneous baseline at zero, so any real gap clears", () => {
    const floors = featureFloors([doc("a", HEAVY)], uniform, OPTIONS);
    expect(floorOf(floors, "heading_rate").floor).toBe(0);
    expect(clearsFloor(floorOf(floors, "heading_rate"))).toBe(true);
  });

  test("a study corpus matching the baseline clears nothing", () => {
    const floors = featureFloors([doc("a", PLAIN)], uniform, OPTIONS);
    expect(floorOf(floors, "heading_rate").gap).toBe(0);
    expect(clearsFloor(floorOf(floors, "heading_rate"))).toBe(false);
  });

  test("a mixed baseline floors above zero", () => {
    const mixed = Array.from({ length: 40 }, (_, index) =>
      doc(`b${index}`, index % 2 === 0 ? PLAIN : HEAVY),
    );
    expect(
      floorOf(featureFloors([doc("a", PLAIN)], mixed, OPTIONS), "heading_rate").floor ?? 0,
    ).toBeGreaterThan(0);
  });

  test("reports no floor when the baseline is too small to split", () => {
    const floor = floorOf(featureFloors([doc("a", PLAIN)], [doc("b", PLAIN)], OPTIONS), "url_rate");
    expect(floor.floor).toBeNull();
    expect(floor.unfloored).toContain("fewer than");
  });

  test("is reproducible for one seed", () => {
    const mixed = Array.from({ length: 30 }, (_, index) =>
      doc(`b${index}`, index % 3 === 0 ? PLAIN : HEAVY),
    );
    const run = (seed: number): (number | null)[] =>
      featureFloors([doc("a", PLAIN)], mixed, { ...OPTIONS, seed }).map((floor) => floor.floor);
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe("margin", () => {
  const base: FeatureFloor = {
    featureId: "f",
    label: "F",
    provenance: "ungoverned",
    baseline: 1,
    study: 3,
    gap: 2,
    floor: 1,
    unfloored: null,
  };

  test("divides the gap by the floor", () => {
    expect(margin(base)).toBe(2);
  });

  test("is null without a floor", () => {
    expect(margin({ ...base, floor: null })).toBeNull();
  });

  test("is infinite against a zero floor", () => {
    expect(margin({ ...base, floor: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("renderReport", () => {
  const row = (over: Partial<FeatureFloor>): FeatureFloor => ({
    featureId: "f",
    label: "F",
    provenance: "ungoverned",
    baseline: 1,
    study: 1,
    gap: 0,
    floor: 1,
    unfloored: null,
    ...over,
  });

  test("prints the floor beside the gap and names the survivors", () => {
    const report = renderReport(
      [
        row({ featureId: "loud", gap: 5, floor: 1 }),
        row({ featureId: "quiet", gap: 0.5, floor: 1 }),
      ],
      OPTIONS,
    );
    expect(report).toContain("1 of 2 features clear their floor.");
    expect(report).toContain("Below floor: quiet");
    expect(report).toContain("5.00x");
  });

  test("marks an unfloored feature n/a and says it stays", () => {
    const report = renderReport(
      [row({ featureId: "unmeasured", floor: null, unfloored: "baseline too small" })],
      OPTIONS,
    );
    expect(report).toContain("n/a");
    expect(report).toContain("No floor for unmeasured: baseline too small. It stays.");
  });

  test("names the split count, percentile and seed", () => {
    expect(renderReport([row({})], OPTIONS)).toContain(
      "200 random splits of corpus B against itself, floor at the 95th percentile, seed 1",
    );
  });
});
