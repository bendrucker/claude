import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CommentKind } from "../detection/types";
import type { Verdict } from "../judge/schema";
import { computeFileEdits, type EditItem } from "./edits";

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    action: "trim",
    category: "restate-the-what",
    confidence: "high",
    rationale: "r",
    rewrite: null,
    ...over,
  };
}

function item(over: Partial<EditItem> = {}): EditItem {
  return {
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    kind: "line",
    verdict: verdict(),
    ...over,
  };
}

describe("computeFileEdits case (a): full-line comment", () => {
  test("deletes a single full-line comment", () => {
    const source = "const x = 1;\n// restate\nconst y = 2;";
    const result = computeFileEdits(source, [
      item({ startLine: 2, endLine: 2, startColumn: 0, endColumn: 10 }),
    ]);
    expect(result.content).toBe("const x = 1;\nconst y = 2;");
    expect(result.skips).toEqual([]);
  });

  test("deletes a multi-line block on its own lines", () => {
    const source = "a();\n/* line one\n   line two */\nb();";
    const result = computeFileEdits(source, [
      item({ startLine: 2, endLine: 3, startColumn: 0, endColumn: 14, kind: "block" }),
    ]);
    expect(result.content).toBe("a();\nb();");
  });
});

describe("computeFileEdits case (b): trailing comment", () => {
  test("strips a trailing line comment, keeping the code and dropping trailing space", () => {
    const source = "count += 1; // increment";
    const result = computeFileEdits(source, [
      item({ startLine: 1, endLine: 1, startColumn: 12, endColumn: source.length }),
    ]);
    expect(result.content).toBe("count += 1;");
  });

  test("skips a trailing block with code after it on the same line", () => {
    const source = "x = 1; /* note */ y = 2;";
    const result = computeFileEdits(source, [
      item({ startLine: 1, endLine: 1, startColumn: 7, endColumn: 17, kind: "block" }),
    ]);
    expect(result.content).toBe(source);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0]?.detail).toMatch(/interleaved/);
  });
});

describe("computeFileEdits case (c): trimToLines", () => {
  test("keeps the comment-relative line and deletes the rest of the span", () => {
    const source = "op = 1;\n# Data migration: convert\n# tool calls have args\ndo_thing();";
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 3,
        startColumn: 0,
        endColumn: 22,
        kind: "line",
        verdict: verdict({ trimToLines: [2] }),
      }),
    ]);
    expect(result.content).toBe("op = 1;\n# tool calls have args\ndo_thing();");
  });

  test("skips a trim that would drop a block's opening or closing delimiter", () => {
    const source = "a();\n/**\n * keep this\n * drop this\n */\nb();";
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 5,
        startColumn: 0,
        endColumn: 3,
        kind: "docstring",
        verdict: verdict({ trimToLines: [2] }),
      }),
    ]);
    expect(result.content).toBe(source);
    expect(result.skips[0]?.detail).toMatch(/delimiter/);
  });

  test("an empty trim falls back to full deletion", () => {
    const source = "x = 1;\n// gone\ny = 2;";
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 2,
        startColumn: 0,
        endColumn: 7,
        verdict: verdict({ trimToLines: [] }),
      }),
    ]);
    expect(result.content).toBe("x = 1;\ny = 2;");
  });
});

describe("computeFileEdits resolution", () => {
  test("deletion wins over a replacement on the same line", () => {
    const source = "keep();\nval(); // note\nmore();";
    const wholeLine = item({ startLine: 2, endLine: 2, startColumn: 0, endColumn: 14 });
    const trailing = item({ startLine: 2, endLine: 2, startColumn: 7, endColumn: 14 });
    const result = computeFileEdits(source, [trailing, wholeLine]);
    expect(result.content).toBe("keep();\nmore();");
  });

  test("ignores keep verdicts", () => {
    const source = "// kept\ncode();";
    const result = computeFileEdits(source, [
      item({
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 7,
        verdict: verdict({ action: "keep", category: null }),
      }),
    ]);
    expect(result.content).toBe(source);
  });
});

describe("computeFileEdits action: rewrite", () => {
  test("replaces a full-line comment with the indented de-voiced text", () => {
    const source = "code();\n    // spans all hosts rather than the last one\n    more();";
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 2,
        startColumn: 4,
        endColumn: 49,
        verdict: verdict({
          action: "rewrite",
          category: "voice",
          rewrite: "// each host keeps its own connection",
        }),
      }),
    ]);
    expect(result.content).toBe("code();\n    // each host keeps its own connection\n    more();");
    expect(result.skips).toEqual([]);
  });

  test("splices a rewritten trailing line comment after the code", () => {
    const source = "count += 1; // bumps the counter, matching the bash original";
    const result = computeFileEdits(source, [
      item({
        startLine: 1,
        endLine: 1,
        startColumn: 12,
        endColumn: source.length,
        verdict: verdict({
          action: "rewrite",
          category: "voice",
          rewrite: "// retries reuse the same counter",
        }),
      }),
    ]);
    expect(result.content).toBe("count += 1; // retries reuse the same counter");
  });

  test("replaces a multi-line block with indented rewrite lines", () => {
    const source = "a();\n  /**\n   * surfaces the product path\n   */\n  b();";
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 4,
        startColumn: 2,
        endColumn: 5,
        kind: "block",
        verdict: verdict({
          action: "rewrite",
          category: "voice",
          rewrite: "/**\n * Returns the resolved request path.\n */",
        }),
      }),
    ]);
    expect(result.content).toBe(
      "a();\n  /**\n   * Returns the resolved request path.\n   */\n  b();",
    );
  });

  test("skips a rewrite of a block interleaved with code on its line", () => {
    const source = "x = 1; /* note */ y = 2;";
    const result = computeFileEdits(source, [
      item({
        startLine: 1,
        endLine: 1,
        startColumn: 7,
        endColumn: 17,
        kind: "block",
        verdict: verdict({ action: "rewrite", category: "voice", rewrite: "/* fact */" }),
      }),
    ]);
    expect(result.content).toBe(source);
    expect(result.skips[0]?.detail).toMatch(/interleaved/);
  });
});

describe("migration-data-migration-mixed convention", () => {
  test("trimToLines:[2] keeps the genuine why line and drops the restatement", async () => {
    const fixture = JSON.parse(
      await Bun.file(
        join(import.meta.dirname, "..", "evals", "fixtures", "migration-data-migration-mixed.json"),
      ).text(),
    );
    const [first, second] = fixture.comment.split("\n") as [string, string];
    expect(fixture.comment.split("\n")).toHaveLength(2);
    expect(fixture.trimToLines).toEqual([2]);

    const source = [first, second, "op.execute()"].join("\n");
    const result = computeFileEdits(source, [
      item({
        startLine: 1,
        endLine: 2,
        startColumn: first.length - first.trimStart().length,
        endColumn: second.length,
        kind: fixture.kind as CommentKind,
        verdict: verdict({ trimToLines: fixture.trimToLines }),
      }),
    ]);
    expect(result.content).toContain("Tool calls have tool_args");
    expect(result.content).not.toContain("Data migration: Convert");
  });
});
