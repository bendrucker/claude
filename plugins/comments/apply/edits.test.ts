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

describe("computeFileEdits", () => {
  const trailingSrc = "count += 1; // increment";
  const trailingRewrite = "count += 1; // bumps the counter, matching the bash original";

  test.each<{
    name: string;
    source: string;
    items: EditItem[];
    expected: string;
    skipsEmpty?: boolean;
    skipsLength?: number;
    skipDetail?: RegExp;
  }>([
    {
      name: "case (a): deletes a single full-line comment",
      source: "const x = 1;\n// restate\nconst y = 2;",
      items: [item({ startLine: 2, endLine: 2, startColumn: 0, endColumn: 10 })],
      expected: "const x = 1;\nconst y = 2;",
      skipsEmpty: true,
    },
    {
      name: "case (a): deletes a multi-line block on its own lines",
      source: "a();\n/* line one\n   line two */\nb();",
      items: [item({ startLine: 2, endLine: 3, startColumn: 0, endColumn: 14, kind: "block" })],
      expected: "a();\nb();",
    },
    {
      name: "case (a): collapses the surrounding blanks when a banner is deleted",
      source: "const x = 1;\n\n// banner\n\nconst y = 2;",
      items: [item({ startLine: 3, endLine: 3, startColumn: 0, endColumn: 9 })],
      expected: "const x = 1;\n\nconst y = 2;",
    },
    {
      name: "case (a): leaves a pre-existing double blank far from any deletion intact",
      source: "const x = 1;\n// banner\nconst y = 2;\n\n\nconst z = 3;",
      items: [item({ startLine: 2, endLine: 2, startColumn: 0, endColumn: 9 })],
      expected: "const x = 1;\nconst y = 2;\n\n\nconst z = 3;",
    },
    {
      name: "case (b): strips a trailing line comment, keeping the code and dropping trailing space",
      source: trailingSrc,
      items: [item({ startLine: 1, endLine: 1, startColumn: 12, endColumn: trailingSrc.length })],
      expected: "count += 1;",
    },
    {
      name: "case (b): skips a trailing block with code after it on the same line",
      source: "x = 1; /* note */ y = 2;",
      items: [item({ startLine: 1, endLine: 1, startColumn: 7, endColumn: 17, kind: "block" })],
      expected: "x = 1; /* note */ y = 2;",
      skipsLength: 1,
      skipDetail: /interleaved/,
    },
    {
      name: "case (c): keeps the comment-relative line and deletes the rest of the span",
      source: "op = 1;\n# Data migration: convert\n# tool calls have args\ndo_thing();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: 22,
          kind: "line",
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected: "op = 1;\n# tool calls have args\ndo_thing();",
    },
    {
      name: "case (c): skips a trim that would drop a block's opening or closing delimiter",
      source: "a();\n/**\n * keep this\n * drop this\n */\nb();",
      items: [
        item({
          startLine: 2,
          endLine: 5,
          startColumn: 0,
          endColumn: 3,
          kind: "docstring",
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected: "a();\n/**\n * keep this\n * drop this\n */\nb();",
      skipDetail: /delimiter/,
    },
    {
      name: "case (c): an empty trim falls back to full deletion",
      source: "x = 1;\n// gone\ny = 2;",
      items: [
        item({
          startLine: 2,
          endLine: 2,
          startColumn: 0,
          endColumn: 7,
          verdict: verdict({ trimToLines: [] }),
        }),
      ],
      expected: "x = 1;\ny = 2;",
    },
    {
      name: "resolution: deletion wins over a replacement on the same line",
      source: "keep();\nval(); // note\nmore();",
      items: [
        item({ startLine: 2, endLine: 2, startColumn: 7, endColumn: 14 }),
        item({ startLine: 2, endLine: 2, startColumn: 0, endColumn: 14 }),
      ],
      expected: "keep();\nmore();",
    },
    {
      name: "resolution: ignores keep verdicts",
      source: "// kept\ncode();",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 7,
          verdict: verdict({ action: "keep", category: null }),
        }),
      ],
      expected: "// kept\ncode();",
    },
    {
      name: "action: rewrite replaces a full-line comment with the indented de-voiced text",
      source: "code();\n    // spans all hosts rather than the last one\n    more();",
      items: [
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
      ],
      expected: "code();\n    // each host keeps its own connection\n    more();",
      skipsEmpty: true,
    },
    {
      name: "action: rewrite splices a rewritten trailing line comment after the code",
      source: trailingRewrite,
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 12,
          endColumn: trailingRewrite.length,
          verdict: verdict({
            action: "rewrite",
            category: "voice",
            rewrite: "// retries reuse the same counter",
          }),
        }),
      ],
      expected: "count += 1; // retries reuse the same counter",
    },
    {
      name: "action: rewrite replaces a multi-line block with indented rewrite lines",
      source: "a();\n  /**\n   * surfaces the product path\n   */\n  b();",
      items: [
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
      ],
      expected: "a();\n  /**\n   * Returns the resolved request path.\n   */\n  b();",
    },
    {
      name: "action: rewrite skips a rewrite of a block interleaved with code on its line",
      source: "x = 1; /* note */ y = 2;",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 7,
          endColumn: 17,
          kind: "block",
          verdict: verdict({ action: "rewrite", category: "voice", rewrite: "/* fact */" }),
        }),
      ],
      expected: "x = 1; /* note */ y = 2;",
      skipDetail: /interleaved/,
    },
  ])("$name", ({ source, items, expected, skipsEmpty, skipsLength, skipDetail }) => {
    const result = computeFileEdits(source, items);
    expect(result.content).toBe(expected);
    if (skipsEmpty) {
      expect(result.skips).toEqual([]);
    }
    if (skipsLength !== undefined) {
      expect(result.skips).toHaveLength(skipsLength);
    }
    if (skipDetail) {
      expect(result.skips[0]?.detail).toMatch(skipDetail);
    }
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
