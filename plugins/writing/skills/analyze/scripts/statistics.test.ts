import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceByCategory,
  acceptedShare,
  clearsFloor,
  describeBand,
  describeRunMethod,
  failedBands,
  loadStatistics,
  measuredFeature,
  unmeasuredBands,
  type RateNullRun,
  byBand,
  sameBand,
  type WritingStatistics,
} from "./statistics";

// Invented floors. Real numbers come from corpora that never leave the machine
// that measured them, so a test asserting one would encode a local artifact.
function run(minWords: number | null, maxWords: number | null, floors: RateNullRun["floors"]) {
  return { splits: 100, percentile: 95, seed: 1, minWords, maxWords, floors };
}

const full = run(null, null, [
  { featureId: "clears_everywhere", gap: 2, floor: 1 },
  { featureId: "length_artifact", gap: 2, floor: 1 },
  { featureId: "unfloored", gap: 2, floor: null },
]);
const banded = run(100, 400, [
  { featureId: "clears_everywhere", gap: 2, floor: 1 },
  { featureId: "length_artifact", gap: 0.5, floor: 1 },
]);

const statistics: WritingStatistics = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  rateNulls: { runs: [full, banded] },
};

describe("describeBand", () => {
  const cases: { name: string; run: RateNullRun; expected: string }[] = [
    { name: "an unbounded run is the full corpus", run: full, expected: "full corpus" },
    { name: "a two-sided band names both ends", run: banded, expected: "100-400 word band" },
    { name: "an open top reads as infinite", run: run(100, null, []), expected: "100-∞ word band" },
    { name: "an open bottom starts at zero", run: run(null, 400, []), expected: "0-400 word band" },
  ];

  it.each(cases)("$name", ({ run: subject, expected }) => {
    expect(describeBand(subject)).toBe(expected);
  });
});

describe("describeRunMethod", () => {
  it("carries each run's own split count, since bands rebuild separately", () => {
    expect(describeRunMethod({ ...banded, splits: 2000 })).toBe(
      "100-400 word band (2000 splits at the 95th percentile)",
    );
  });
});

describe("sameBand", () => {
  it("matches runs covering the same band", () => {
    expect(sameBand(banded, run(100, 400, []))).toBe(true);
  });

  it("separates the full corpus from a band", () => {
    expect(sameBand(full, banded)).toBe(false);
  });

  it("separates bands sharing one bound", () => {
    expect(sameBand(banded, run(100, 500, []))).toBe(false);
  });
});

describe("byBand", () => {
  const openTop = run(100, null, []);

  it("leads with the full corpus, whichever order the merge appended", () => {
    expect([banded, full].toSorted(byBand)).toEqual([full, banded]);
    expect([full, banded].toSorted(byBand)).toEqual([full, banded]);
  });

  // Both bands run to infinity, so comparing their widths alone ties and leaves
  // the order to however the merge appended them.
  it("leads with the full corpus against an open-topped band", () => {
    expect([openTop, full].toSorted(byBand)).toEqual([full, openTop]);
    expect([full, openTop].toSorted(byBand)).toEqual([full, openTop]);
  });

  it("puts a wider band ahead of a narrower one", () => {
    expect([banded, run(100, 900, [])].toSorted(byBand)).toEqual([run(100, 900, []), banded]);
  });
});

describe("clearsFloor", () => {
  const cases: { name: string; gap: number; floor: number | null; expected: boolean }[] = [
    { name: "a gap above its floor clears", gap: 2, floor: 1, expected: true },
    { name: "a gap under its floor is noise", gap: 0.5, floor: 1, expected: false },
    { name: "a gap equal to its floor is noise", gap: 1, floor: 1, expected: false },
    { name: "an absent floor leaves the feature alone", gap: 0, floor: null, expected: true },
  ];

  it.each(cases)("$name", ({ gap, floor, expected }) => {
    expect(clearsFloor({ featureId: "f", gap, floor })).toBe(expected);
  });
});

describe("failedBands", () => {
  it("is empty for a feature clearing every band", () => {
    expect(failedBands(statistics, "clears_everywhere")).toEqual([]);
  });

  it("names the band a length artifact fails, though it cleared the full corpus", () => {
    expect(failedBands(statistics, "length_artifact")).toEqual(["100-400 word band"]);
  });

  it("is empty for a feature no run measured", () => {
    expect(failedBands(statistics, "never_measured")).toEqual([]);
  });

  it("is empty when no statistics were written", () => {
    expect(failedBands(null, "clears_everywhere")).toEqual([]);
  });
});

describe("unmeasuredBands", () => {
  // Bands rebuild independently, so the banded run here predates the feature
  // the full-corpus run measures. Reporting that feature as cleared would
  // certify a gap no band-restricted null ever tested, which is the length
  // confound the banding exists to catch.
  it("names the band a retained run never measured", () => {
    expect(unmeasuredBands(statistics, "unfloored")).toEqual(["100-400 word band"]);
  });

  it("is empty for a feature every stored run carries", () => {
    expect(unmeasuredBands(statistics, "clears_everywhere")).toEqual([]);
  });

  it("names every band for a feature no run measured", () => {
    expect(unmeasuredBands(statistics, "never_measured")).toEqual([
      "full corpus",
      "100-400 word band",
    ]);
  });

  it("is empty when no statistics were written", () => {
    expect(unmeasuredBands(null, "clears_everywhere")).toEqual([]);
  });
});

describe("measuredFeature", () => {
  it("separates an unmeasured feature from one that cleared", () => {
    expect(measuredFeature(statistics, "clears_everywhere")).toBe(true);
    expect(measuredFeature(statistics, "never_measured")).toBe(false);
    expect(measuredFeature(null, "clears_everywhere")).toBe(false);
  });
});

describe("acceptedShare", () => {
  it("withholds a rate until enough findings were revisited", () => {
    expect(acceptedShare({ category: "a", fired: 100, revisited: 19, accepted: 19 })).toBeNull();
  });

  it("divides accepted by revisited once the evidence is there", () => {
    expect(acceptedShare({ category: "a", fired: 100, revisited: 20, accepted: 5 })).toBe(0.25);
  });
});

describe("acceptanceByCategory", () => {
  it("keys the hook-health rows by category", () => {
    const health = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      hookHealth: {
        runs: 10,
        spanDays: 5,
        categories: [{ category: "trope", fired: 9, revisited: 4, accepted: 2 }],
      },
    };
    expect(acceptanceByCategory(health).get("trope")?.accepted).toBe(2);
  });

  it("is empty without a hook-health section", () => {
    expect(acceptanceByCategory(statistics).size).toBe(0);
    expect(acceptanceByCategory(null).size).toBe(0);
  });
});

describe("loadStatistics", () => {
  it("returns null for a path the analyze scripts never wrote", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statistics-"));
    expect(await loadStatistics(join(dir, "statistics.json"))).toBeNull();
  });

  it("round-trips a written artifact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statistics-"));
    const path = join(dir, "statistics.json");
    await Bun.write(path, JSON.stringify(statistics));
    expect(await loadStatistics(path)).toEqual(statistics);
  });

  it("reads a file whose sections do not match the schema as absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statistics-"));
    const path = join(dir, "statistics.json");
    await Bun.write(path, JSON.stringify({ generatedAt: 1 }));
    expect(await loadStatistics(path)).toBeNull();
  });

  it("reads a torn write as absent rather than failing the scan reading it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statistics-"));
    const path = join(dir, "statistics.json");
    await Bun.write(path, '{"generatedAt":"2026-09-16T00:00:00Z","hookHealth":{"runs":1,"span');
    expect(await loadStatistics(path)).toBeNull();
  });
});
