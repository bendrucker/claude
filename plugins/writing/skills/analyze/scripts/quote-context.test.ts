import { describe, expect, test } from "bun:test";
import { findQuote } from "./quote-context";

describe("findQuote", () => {
  const rows = [
    {
      session_id: "s1",
      source_file: "a.jsonl",
      source_line: 5,
      file_path: "tmp/pr-body.md",
      text: "The auto-instrumented spans are the source of truth for tracing.",
    },
    {
      session_id: "s2",
      source_file: "b.jsonl",
      source_line: 9,
      file_path: null,
      text: "We should make the loader fail loudly on partial input.",
    },
  ];

  test("finds an exact phrase and returns a context window plus pointer", () => {
    const quote = findQuote("source of truth", rows);
    expect(quote?.window).toContain("source of truth");
    expect(quote?.filePath).toBe("tmp/pr-body.md");
    expect(quote?.sourceFile).toBe("a.jsonl");
    expect(quote?.sourceLine).toBe(5);
  });

  test("finds an inflected phrase via stemmed fallback", () => {
    const quote = findQuote("fails loudly", [
      {
        session_id: "s3",
        source_file: "c.jsonl",
        source_line: 1,
        file_path: null,
        text: "The loader fail loudly here.",
      },
    ]);
    expect(quote?.window).toContain("fail loudly");
    expect(quote?.sourceFile).toBe("c.jsonl");
  });

  test("falls back to source_file pointer when file_path is absent", () => {
    const quote = findQuote("fail loudly", rows);
    expect(quote?.filePath).toBeNull();
    expect(quote?.sourceFile).toBe("b.jsonl");
  });

  test("returns null when the phrase is not found", () => {
    expect(findQuote("nonexistent phrase", rows)).toBeNull();
  });

  test("truncates the window with ellipses for long text", () => {
    const long = `${"x ".repeat(100)}source of truth${" y".repeat(100)}`;
    const quote = findQuote("source of truth", [{ session_id: "s", text: long }]);
    expect(quote?.window.startsWith("...")).toBe(true);
    expect(quote?.window.endsWith("...")).toBe(true);
  });
});
