import { describe, expect, test } from "bun:test";
import { auditDeliverableCorpus, isDeliverableSurface } from "./deliverable-audit";
import type { WordlistEntry } from "./wordlists";

describe("isDeliverableSurface", () => {
  test("flowery phrases and soft phrasing are deliverable-surface", () => {
    expect(isDeliverableSurface("flowery-phrases.txt")).toBe(true);
    expect(isDeliverableSurface("soft-phrasing.txt")).toBe(true);
  });

  test("openers, vocabulary, and marketing verbs are not deliverable-surface", () => {
    expect(isDeliverableSurface("openers.txt")).toBe(false);
    expect(isDeliverableSurface("vocabulary.txt")).toBe(false);
    expect(isDeliverableSurface("marketing-verbs.txt")).toBe(false);
  });
});

describe("auditDeliverableCorpus", () => {
  const entries: WordlistEntry[] = [
    { phrase: "source of truth", source: "flowery-phrases.txt" },
    { phrase: "fail loudly", source: "flowery-phrases.txt" },
    { phrase: "cleanly", source: "soft-phrasing.txt" },
  ];

  test("counts stemmed phrase occurrences across rows", () => {
    const rows = [
      { text: "This is the source of truth for the cache." },
      { text: "The sources of truth diverge. It fails loudly on error." },
      { text: "It strips cleanly and loads cleanly." },
    ];
    const audit = auditDeliverableCorpus(entries, rows);
    expect(audit.byPhrase.get("source of truth")?.count).toBe(2);
    expect(audit.byPhrase.get("fail loudly")?.count).toBe(1);
    expect(audit.byPhrase.get("cleanly")?.count).toBe(2);
    expect(audit.totalTokens).toBeGreaterThan(0);
  });

  test("reports per-million rates against the corpus token total", () => {
    const audit = auditDeliverableCorpus(
      [{ phrase: "cleanly", source: "soft-phrasing.txt" }],
      [{ text: "loads cleanly" }],
    );
    const row = audit.byPhrase.get("cleanly");
    expect(row?.count).toBe(1);
    expect(row?.perMillion).toBeCloseTo((1 / audit.totalTokens) * 1_000_000, 1);
  });

  test("ignores code-shaped artifacts via cleanText", () => {
    const audit = auditDeliverableCorpus(
      [{ phrase: "cleanly", source: "soft-phrasing.txt" }],
      [{ text: "Run `cleanly()` then describe it." }],
    );
    expect(audit.byPhrase.get("cleanly")?.count).toBe(0);
  });
});
