import { describe, expect, it } from "bun:test";
import type { HeadingClassifier } from "../../../linguistics/heading";
import {
  dedupeHeadings,
  evaluateClassifiers,
  extractHeadings,
  formatPowerReport,
  parseLabelsFile,
  sampleForLabeling,
  scoreAgainstLabels,
  wilson,
} from "./headings-eval";

describe("extractHeadings", () => {
  it("extracts heading text at every level", () => {
    const markdown = "# Title\n\nbody\n\n## Section Label\n\n### Deep Dive\n";
    expect(extractHeadings(markdown)).toEqual(["Title", "Section Label", "Deep Dive"]);
  });

  it("skips all-inline-code headings", () => {
    expect(extractHeadings("## `context: fork`\n")).toEqual([]);
  });

  it("drops inline code from mixed headings like the hook does", () => {
    expect(extractHeadings("## The `useCache` Hook\n")).toEqual(["The  Hook"]);
  });

  it("ignores non-heading content", () => {
    expect(extractHeadings("plain paragraph\n\n- list item\n")).toEqual([]);
  });
});

describe("dedupeHeadings", () => {
  it("counts occurrences and session spread", () => {
    const rows = [
      { session_id: "a", text: "## Cache Layer\n\n## Testing\n" },
      { session_id: "a", text: "## Cache Layer\n" },
      { session_id: "b", text: "## Cache Layer\n" },
    ];
    expect(dedupeHeadings(rows)).toEqual([
      { heading: "Cache Layer", occurrences: 3, sessions: 2 },
      { heading: "Testing", occurrences: 1, sessions: 1 },
    ]);
  });

  it("skips rows without text", () => {
    expect(dedupeHeadings([{ session_id: "a" }])).toEqual([]);
  });
});

function fake(name: string, flagWhen: (heading: string) => boolean): HeadingClassifier {
  return {
    name,
    classify: (heading) => ({
      kind: flagWhen(heading) ? "clause" : "noun-phrase",
      flagged: flagWhen(heading),
      evidence: [],
    }),
  };
}

describe("evaluateClassifiers", () => {
  const headings = [
    { heading: "Latency is High", occurrences: 2, sessions: 2 },
    { heading: "Cache Layer", occurrences: 5, sessions: 3 },
    { heading: "Run the Migration", occurrences: 1, sessions: 1 },
  ];
  const baseline = fake("baseline", (h) => h.includes("is"));
  const candidate = fake("candidate", (h) => h.includes("is") || h.startsWith("Run"));

  it("computes flag rate and agreement against the first classifier", () => {
    const { stats, disagreements } = evaluateClassifiers(headings, [baseline, candidate]);
    expect(stats[0]).toEqual({
      name: "baseline",
      flags: 1,
      flagRate: 1 / 3,
      agreement: 1,
      disagreements: 0,
    });
    expect(stats[1]?.flags).toBe(2);
    expect(stats[1]?.disagreements).toBe(1);
    expect(disagreements).toEqual(["Run the Migration"]);
  });
});

describe("wilson", () => {
  it("brackets the point estimate", () => {
    const { lo, hi } = wilson(9, 10);
    expect(lo).toBeGreaterThan(0.5);
    expect(lo).toBeLessThan(0.9);
    expect(hi).toBeGreaterThan(0.9);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it("handles zero trials", () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe("parseLabelsFile", () => {
  it("parses labeled rows and skips comments", () => {
    const content = [
      "# heading\tlabel\tsource",
      "Latency is High\tclause\tdisagreement",
      "Cache Layer\tnoun-phrase\trandom",
      "",
    ].join("\n");
    expect(parseLabelsFile(content)).toEqual([
      { heading: "Latency is High", label: "clause", source: "disagreement" },
      { heading: "Cache Layer", label: "noun-phrase", source: "random" },
    ]);
  });

  it("skips rows without a label", () => {
    expect(parseLabelsFile("Unlabeled Heading\t\trandom\n")).toEqual([]);
  });

  it("rejects unknown labels", () => {
    expect(() => parseLabelsFile("Heading\tbogus\trandom\n")).toThrow("Unknown label");
  });
});

describe("sampleForLabeling", () => {
  const headings = Array.from({ length: 10 }, (_, i) => ({
    heading: `H${i}`,
    occurrences: 1,
    sessions: 1,
  }));
  const disagreements = ["H0", "H1", "H2", "H3"];

  it("caps disagreements and keeps them out of the random pool", () => {
    // The reproducibility leak (#769): uncapped disagreements polluting the
    // unbiased random subset. The cap bounds the disagreement rows, and the
    // random pool excludes every capped disagreement so the unbiased subset
    // stays unbiased.
    const sample = sampleForLabeling(headings, disagreements, 5, 2);
    const byHeading = new Map(sample.map((row) => [row.heading, row.source]));

    const disagreementRows = sample.filter((row) => row.source === "disagreement");
    expect(disagreementRows.map((row) => row.heading).sort()).toEqual(["H0", "H1"]);

    const randomRows = sample.filter((row) => row.source === "random");
    for (const row of randomRows) {
      expect(["H0", "H1"]).not.toContain(row.heading);
    }
    // A capped-out disagreement may still appear, but only as a random draw.
    for (const capped of ["H2", "H3"]) {
      if (byHeading.has(capped)) expect(byHeading.get(capped)).toBe("random");
    }
  });

  it("never draws the same heading as both disagreement and random", () => {
    const sample = sampleForLabeling(headings, disagreements, 10, 4);
    const headingsSeen = sample.map((row) => row.heading);
    expect(new Set(headingsSeen).size).toBe(headingsSeen.length);
  });
});

describe("formatPowerReport", () => {
  it("reports the positives needed to detect a target lift", () => {
    const report = formatPowerReport(
      { positives: 24, total: 499, label: "labeled random subset" },
      20,
    );
    expect(report).toContain("20pp detectable lift");
    expect(report).toContain("labeled random subset");
    expect(report).toContain("positive labels");
    // 20pp at worst-case 0.5 needs 97 positives, ~4x the current 24.
    expect(report).toContain("97");
    expect(report).toContain("4.0x");
  });
});

describe("scoreAgainstLabels", () => {
  it("computes precision and recall", () => {
    const labeled = [
      { heading: "Latency is High", label: "clause" as const, source: "random" as const },
      { heading: "Cache Layer", label: "noun-phrase" as const, source: "random" as const },
      { heading: "Run the Migration", label: "imperative" as const, source: "random" as const },
    ];
    const classifier = fake("candidate", (h) => h.includes("is") || h.includes("Cache"));
    const [score] = scoreAgainstLabels(labeled, [classifier]);
    expect(score?.tp).toBe(1);
    expect(score?.fp).toBe(1);
    expect(score?.fn).toBe(1);
    expect(score?.precision).toBe(0.5);
    expect(score?.recall).toBe(0.5);
  });
});
