import { describe, expect, test } from "bun:test";
import { auditStructuralPatterns, STRUCTURAL_PATTERNS } from "./structural";

describe("STRUCTURAL_PATTERNS", () => {
  test("all patterns have the global flag for accurate counting", () => {
    for (const sp of STRUCTURAL_PATTERNS) {
      expect(sp.pattern.global).toBe(true);
    }
  });
});

describe("auditStructuralPatterns", () => {
  test("counts hits across rows and deduplicates sessions", () => {
    const assistantRows = [
      { session_id: "s1", text: "This looks like a problem. It seems to be broken." },
      { session_id: "s1", text: "That appears to be the cause." },
      { session_id: "s2", text: "It looks like the config is wrong." },
    ];
    const userRows = [{ text: "looks like you found it" }];
    const result = auditStructuralPatterns(assistantRows, userRows);
    const hedging = result.find((r) => r.category === "hedging observation");
    expect(hedging).toBeDefined();
    expect(hedging?.assistantHits).toBe(4);
    expect(hedging?.assistantRows).toBe(3);
    expect(hedging?.assistantSessions).toBe(2);
    expect(hedging?.userHits).toBe(1);
  });

  test("strips code blocks before scanning", () => {
    const rows = [
      {
        session_id: "s1",
        text: "Normal text. ```\nif (looks like something) {}\n``` More text.",
      },
    ];
    const result = auditStructuralPatterns(rows, []);
    const hedging = result.find((r) => r.category === "hedging observation");
    expect(hedging?.assistantHits).toBe(0);
  });

  test("skips rows without text", () => {
    const rows = [{ session_id: "s1", text: undefined }];
    const result = auditStructuralPatterns(rows, []);
    for (const r of result) {
      expect(r.assistantHits).toBe(0);
    }
  });

  test("counts multiple occurrences in a single row", () => {
    const rows = [
      {
        session_id: "s1",
        text: "- **src/foo.ts**: does thing\n- **src/bar.ts**: does other thing\n- **src/baz.ts**: third",
      },
    ];
    const result = auditStructuralPatterns(rows, []);
    const pathBullet = result.find((r) => r.category === "path bullet");
    expect(pathBullet?.assistantHits).toBe(3);
    expect(pathBullet?.assistantRows).toBe(1);
  });
});
