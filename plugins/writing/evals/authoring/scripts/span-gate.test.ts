import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Key } from "./pairs";
import {
  catalogRules,
  defectSpans,
  indexedScan,
  loadLabels,
  loadPairs,
  overlaps,
  parseRule,
  precisionPool,
  type Rule,
  renderBaseline,
  renderReport,
  scoreBaseline,
  scoreCatalog,
  scoreRules,
  wordlistRule,
} from "./span-gate";

const pair = (id: string, aText: string, bText: string) => ({
  id,
  case: "case-1",
  surface: "pr" as const,
  brief: "brief",
  a: { source: { kind: "original" as const, url: "https://example.com" }, text: aText },
  b: { source: { kind: "original" as const, url: "https://example.com" }, text: bText },
});

const span = (key: Key, start: number, end: number, severity: "critical" | "minor" | "praise") => ({
  key,
  start,
  end,
  text: "",
  severity,
  note: "",
});

const label = (id: string, pick: "a" | "b" | "tie", spans: ReturnType<typeof span>[]) => ({
  id,
  pick,
  left: "a" as const,
  spans,
  notes: "",
});

describe("overlaps", () => {
  test.each([
    ["identical ranges", { start: 0, end: 5 }, { start: 0, end: 5 }, true],
    ["partial overlap", { start: 0, end: 5 }, { start: 3, end: 8 }, true],
    ["contained", { start: 2, end: 3 }, { start: 0, end: 10 }, true],
    ["touching endpoints do not overlap", { start: 0, end: 5 }, { start: 5, end: 10 }, false],
    ["disjoint", { start: 0, end: 5 }, { start: 10, end: 15 }, false],
  ])("%s", (_name, a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
  });
});

describe("defectSpans", () => {
  test("pools critical and minor spans across both drafts, dropping praise", () => {
    const spans = defectSpans([
      label("p1", "a", [
        span("a", 0, 5, "critical"),
        span("b", 10, 15, "minor"),
        span("a", 20, 25, "praise"),
      ]),
      label("p2", "b", [span("b", 0, 3, "minor")]),
    ]);
    expect(spans).toEqual([
      { pairId: "p1", key: "a", start: 0, end: 5 },
      { pairId: "p1", key: "b", start: 10, end: 15 },
      { pairId: "p2", key: "b", start: 0, end: 3 },
    ]);
  });
});

describe("precisionPool", () => {
  test("keeps only the winning draft of each non-tie pair", () => {
    const pairs = new Map([
      ["p1", pair("p1", "draft a text", "draft b text")],
      ["p2", pair("p2", "another a", "another b")],
    ]);
    const labels = [label("p1", "a", []), label("p2", "tie", [])];
    expect(precisionPool(pairs, labels)).toEqual([
      { pairId: "p1", key: "a", text: "draft a text" },
    ]);
  });

  test("skips a label with no matching pair", () => {
    const pairs = new Map([["p1", pair("p1", "a text", "b text")]]);
    expect(precisionPool(pairs, [label("missing", "a", [])])).toEqual([]);
  });
});

describe("indexedScan", () => {
  test("reports char offsets for a plain regex rule", () => {
    const rule: Rule = { kind: "regex", category: "em dash", test: / — /g };
    expect(indexedScan("one — two", rule)).toEqual([{ category: "em dash", start: 3, end: 6 }]);
  });

  test("offsets survive fenced code, since stripCode blanks it in place", () => {
    const rule: Rule = { kind: "regex", category: "em dash", test: / — /g };
    const text = "```\na — b\n```\nc — d";
    const hits = indexedScan(text, rule);
    expect(hits).toEqual([{ category: "em dash", start: 15, end: 18 }]);
    expect(text.slice(15, 18)).toBe(" — ");
  });

  test("a wordlist rule matches stemmed word tokens", () => {
    const rule = wordlistRule("candidate vocab", "delve\n");
    expect(indexedScan("Let's delve into the details.", rule)).toEqual([
      { category: "candidate vocab", start: 6, end: 11 },
    ]);
  });

  test("the shipped catalog includes the AI vocabulary list", () => {
    const rules = catalogRules();
    const vocabulary = rules.find((r) => r.category === "AI vocabulary");
    expect(vocabulary).toBeDefined();
    if (!vocabulary) return;
    expect(indexedScan("Let's delve into this.", vocabulary).length).toBeGreaterThan(0);
  });
});

describe("parseRule", () => {
  test("parses name=/pattern/flags", () => {
    const rule = parseRule(String.raw`delve=/\bdelve\b/i`);
    expect(rule).toEqual({ kind: "regex", category: "delve", test: /\bdelve\b/gi });
  });

  test("rejects a spec with no pattern body", () => {
    expect(() => parseRule("delve=notaregex")).toThrow();
  });
});

describe("scoreRules and scoreCatalog", () => {
  // "delve" sits at chars 3-8 of "We delve often."; p1's winner ("b") has no defect and no hit,
  // p2's winner ("b") carries an unmarked hit, so precision has a denominator without a numerator.
  const pairs = new Map([
    ["p1", pair("p1", "We delve often.", "A plain and clear line.")],
    ["p2", pair("p2", "Another plain phrase.", "We delve daily.")],
  ]);
  const labels = [label("p1", "b", [span("a", 3, 8, "critical")]), label("p2", "b", [])];
  const rule: Rule = { kind: "regex", category: "delve", test: /delve/gi };

  test("recall counts a defect span the rule overlaps, on either draft", () => {
    const score = scoreRules([rule], pairs, labels);
    expect(score).toMatchObject({ recallHits: 1, totalDefects: 1 });
  });

  test("precision is scored only on the drafts Ben preferred", () => {
    const score = scoreRules([rule], pairs, labels);
    // p1's winner "b" has no "delve"; p2's winner "b" has an unmarked "delve": one flagged, zero confirmed.
    expect(score).toMatchObject({ flagged: 1, confirmed: 0, precision: 0 });
  });

  test("scoreCatalog sorts rules by recall and marks under-flagged rules unjudged", () => {
    const reports = scoreCatalog([rule], pairs, labels, 10);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ rule: "delve", judged: false });
  });
});

describe("scoreBaseline", () => {
  test("passes when the candidate recalls more without losing the precision floor", () => {
    const pairs = new Map([["p1", pair("p1", "We delve often.", "A plain and clear line.")]]);
    const labels = [label("p1", "b", [span("a", 3, 8, "critical")])];
    const shipped: Rule[] = [{ kind: "regex", category: "em dash", test: / — /g }];
    const candidate: Rule[] = [{ kind: "regex", category: "delve", test: /delve/gi }];
    const verdict = scoreBaseline(shipped, candidate, pairs, labels);
    expect(verdict).toMatchObject({ recallRises: true, pass: true });
  });
});

describe("rendering", () => {
  test("renderReport includes the too few to judge floor", () => {
    const reports = scoreCatalog(
      [{ kind: "regex", category: "delve", test: /delve/gi }],
      new Map([["p1", pair("p1", "We delve often.", "Plain text here.")]]),
      [label("p1", "b", [span("a", 3, 8, "critical")])],
      10,
    );
    const text = renderReport(reports, 10);
    expect(text).toContain("too few to judge");
    expect(text).toContain("delve");
  });

  test("renderBaseline reports the gate verdict", () => {
    const pairs = new Map([["p1", pair("p1", "We delve often.", "A plain and clear line.")]]);
    const labels = [label("p1", "b", [span("a", 3, 8, "critical")])];
    const verdict = scoreBaseline(
      [{ kind: "regex", category: "em dash", test: / — /g }],
      [{ kind: "regex", category: "delve", test: /delve/gi }],
      pairs,
      labels,
    );
    expect(renderBaseline(verdict)).toContain("gate: pass");
  });
});

describe("loadPairs and loadLabels", () => {
  test("parse a directory of JSON files against the Pair and Label schemas", async () => {
    const pairsDir = mkdtempSync(join(tmpdir(), "span-gate-pairs-"));
    const labelsDir = mkdtempSync(join(tmpdir(), "span-gate-labels-"));
    await Bun.write(join(pairsDir, "p1.json"), JSON.stringify(pair("p1", "a text", "b text")));
    await Bun.write(
      join(labelsDir, "p1.json"),
      JSON.stringify(label("p1", "a", [span("a", 0, 2, "critical")])),
    );

    const pairs = await loadPairs(pairsDir);
    const labels = await loadLabels(labelsDir);
    expect(pairs.get("p1")?.a.text).toBe("a text");
    expect(labels).toHaveLength(1);
    expect(labels[0]?.spans).toHaveLength(1);
  });
});
