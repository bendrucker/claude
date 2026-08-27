import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
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
    options?: { maxWidth?: number };
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
      name: "trimTo: replaces an indented full-line comment span with the kept text",
      source:
        "code();\n    // walk the list and retry each entry, reusing\n    // the same backoff: rate-limited per key\n    more();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 4,
          endColumn: "    // the same backoff: rate-limited per key".length,
          verdict: verdict({ trimTo: "// retries reuse the first backoff: rate-limited per key" }),
        }),
      ],
      expected:
        "code();\n    // retries reuse the first backoff: rate-limited per key\n    more();",
      skipsEmpty: true,
    },
    {
      name: "trimTo: replaces a docstring block with the kept text",
      source:
        "a();\n  /**\n   * Walks the loop and retries.\n   * The broker rate-limits per key.\n   */\n  b();",
      items: [
        item({
          startLine: 2,
          endLine: 5,
          startColumn: 2,
          endColumn: 5,
          kind: "docstring",
          verdict: verdict({ trimTo: "/** The broker rate-limits per key. */" }),
        }),
      ],
      expected: "a();\n  /** The broker rate-limits per key. */\n  b();",
      skipsEmpty: true,
    },
    {
      name: "trimTo: splices the kept text after the code for a trailing line comment",
      source: "count += 1; // increment the counter, reusing the shared backoff",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 12,
          endColumn: "count += 1; // increment the counter, reusing the shared backoff".length,
          verdict: verdict({ trimTo: "// reuses the shared backoff" }),
        }),
      ],
      expected: "count += 1; // reuses the shared backoff",
      skipsEmpty: true,
    },
    {
      name: "trimTo: skips a block interleaved with code on its line",
      source: "x = 1; /* note */ y = 2;",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 7,
          endColumn: 17,
          kind: "block",
          verdict: verdict({ trimTo: "/* fact */" }),
        }),
      ],
      expected: "x = 1; /* note */ y = 2;",
      skipDetail: /interleaved/,
    },
    {
      name: "fragment guard: skips a trimToLines keep opening with 'the' after an unterminated drop",
      source:
        "op();\n# walk the queue and retry each entry, reusing\n# the same backoff: rate-limited per key\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "# the same backoff: rate-limited per key".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected:
        "op();\n# walk the queue and retry each entry, reusing\n# the same backoff: rate-limited per key\ndone();",
      skipDetail: /mid-sentence fragment/,
    },
    {
      name: "fragment guard: skips a trimToLines keep opening with 'others' after an unterminated drop",
      source:
        "op();\n// dedupe entries that repeat and drop\n// others that expired already\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "// others that expired already".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected:
        "op();\n// dedupe entries that repeat and drop\n// others that expired already\ndone();",
      skipDetail: /mid-sentence fragment/,
    },
    {
      name: "fragment guard: matches a connective carrying trailing punctuation",
      source:
        "op();\n# retry each entry with the backoff\n# that, in turn, the broker chose\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "# that, in turn, the broker chose".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected:
        "op();\n# retry each entry with the backoff\n# that, in turn, the broker chose\ndone();",
      skipDetail: /mid-sentence fragment/,
    },
    {
      name: "fragment guard: strips SQL-style markers before reading the boundary",
      source:
        "op();\n-- walk the table and update rows, keeping\n-- the same checksum as before\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "-- the same checksum as before".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected:
        "op();\n-- walk the table and update rows, keeping\n-- the same checksum as before\ndone();",
      skipDetail: /mid-sentence fragment/,
    },
    {
      name: "fragment guard: does not fire on a sentence-opening preposition",
      source: "op();\n# walk the queue and rebuild it\n# For each entry, retry once.\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "# For each entry, retry once.".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected: "op();\n# For each entry, retry once.\ndone();",
      skipsEmpty: true,
    },
    {
      name: "fragment guard: does not fire on an identifier-led kept line",
      source: "op();\n# checks each flag value\n# bool is coerced to int here\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "# bool is coerced to int here".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected: "op();\n# bool is coerced to int here\ndone();",
      skipsEmpty: true,
    },
    {
      name: "fragment guard: does not fire when the dropped boundary ends a sentence",
      source: "op();\n# The loop retries each entry.\n# The broker rate-limits per key.\ndone();",
      items: [
        item({
          startLine: 2,
          endLine: 3,
          startColumn: 0,
          endColumn: "# The broker rate-limits per key.".length,
          verdict: verdict({ trimToLines: [2] }),
        }),
      ],
      expected: "op();\n# The broker rate-limits per key.\ndone();",
      skipsEmpty: true,
    },
    {
      name: "width: refuses a splice over an explicit maxWidth",
      source: "count += 1; // note",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 12,
          endColumn: "count += 1; // note".length,
          verdict: verdict({
            trimTo: "// a kept clause long enough to overflow the configured width limit",
          }),
        }),
      ],
      expected: "count += 1; // note",
      options: { maxWidth: 40 },
      skipsLength: 1,
      skipDetail: /over 40/,
    },
    {
      name: "width: applies the same splice when no maxWidth is passed",
      source: "count += 1; // note",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 12,
          endColumn: "count += 1; // note".length,
          verdict: verdict({
            trimTo: "// a kept clause long enough to overflow the configured width limit",
          }),
        }),
      ],
      expected: "count += 1; // a kept clause long enough to overflow the configured width limit",
      skipsEmpty: true,
    },
    {
      name: "syntax: a trimTo of bare prose regains the site's javadoc delimiters",
      source:
        "class A {\n    /**\n     * Walks the loop and retries.\n     * The broker rate-limits per key.\n     */\n    void f() {}\n}",
      items: [
        item({
          startLine: 2,
          endLine: 5,
          startColumn: 4,
          endColumn: 7,
          kind: "docstring",
          verdict: verdict({ trimTo: "The broker rate-limits per key." }),
        }),
      ],
      expected: "class A {\n    /** The broker rate-limits per key. */\n    void f() {}\n}",
      skipsEmpty: true,
    },
    {
      name: "syntax: a multi-line trimTo of bare prose regains star continuations",
      source: "  /**\n   * One.\n   * Two.\n   * Three.\n   */\n  b();",
      items: [
        item({
          startLine: 1,
          endLine: 5,
          startColumn: 2,
          endColumn: 5,
          kind: "docstring",
          verdict: verdict({ trimTo: "One.\nThree." }),
        }),
      ],
      expected: "  /**\n   * One.\n   * Three.\n   */\n  b();",
      skipsEmpty: true,
    },
    {
      name: "syntax: a trailing line comment in a chain keeps its marker",
      source: "        .retryOn(RATE_LIMIT) // the broker rate-limits per key",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 28,
          endColumn: "        .retryOn(RATE_LIMIT) // the broker rate-limits per key".length,
          verdict: verdict({ trimTo: "rate-limited per key" }),
        }),
      ],
      expected: "        .retryOn(RATE_LIMIT) // rate-limited per key",
      skipsEmpty: true,
    },
    {
      name: "syntax: a rust doc comment keeps its doc marker through a trimTo",
      source: "/// This method walks the loop and retries.\nfn retry() {}",
      items: [
        item({
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: "/// This method walks the loop and retries.".length,
          verdict: verdict({ trimTo: "Retries reuse the first backoff." }),
        }),
      ],
      expected: "/// Retries reuse the first backoff.\nfn retry() {}",
      skipsEmpty: true,
    },
    {
      name: "syntax: refuses a trimTo at a site whose delimiters go unrecognized",
      source:
        "=begin\nThis method walks the loop.\nThe broker rate-limits per key.\n=end\ndef retry; end",
      items: [
        item({
          startLine: 1,
          endLine: 4,
          startColumn: 0,
          endColumn: 4,
          kind: "block",
          verdict: verdict({ trimTo: "The broker rate-limits per key." }),
        }),
      ],
      expected:
        "=begin\nThis method walks the loop.\nThe broker rate-limits per key.\n=end\ndef retry; end",
      skipsLength: 1,
      skipDetail: /delimiters the applier does not recognize/,
    },
    {
      name: "syntax: refuses a trimTo carrying a form the site cannot host",
      source: "  /**\n   * Walks the loop.\n   */\n  b();",
      items: [
        item({
          startLine: 1,
          endLine: 3,
          startColumn: 2,
          endColumn: 5,
          kind: "docstring",
          verdict: verdict({ trimTo: "// Walks the loop." }),
        }),
      ],
      expected: "  /**\n   * Walks the loop.\n   */\n  b();",
      skipsLength: 1,
      skipDetail: /does not match the \/\*\* \*\//,
    },
    {
      name: "blank collapse: drops the blank left under a block opener by a deleted docstring",
      source: "def f():\n    # says what it does\n\n    return 1",
      items: [
        item({
          startLine: 2,
          endLine: 2,
          startColumn: 4,
          endColumn: "    # says what it does".length,
        }),
      ],
      expected: "def f():\n    return 1",
      skipsEmpty: true,
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
  ])("$name", ({ source, items, expected, options, skipsEmpty, skipsLength, skipDetail }) => {
    const result = computeFileEdits(source, items, options);
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

  test("a rewrite carrying its own indentation lands at the site's indentation", () => {
    const source = [
      "class Broker {",
      "    /**",
      "     * This method walks the loop and retries.",
      "     */",
      "    void retry() {}",
      "}",
    ].join("\n");
    const result = computeFileEdits(source, [
      item({
        startLine: 2,
        endLine: 4,
        startColumn: 4,
        endColumn: 7,
        kind: "docstring",
        verdict: verdict({
          action: "rewrite",
          category: "voice",
          rewrite: "    /**\n     * Retries until the broker's per-key limit clears.\n     */",
        }),
      }),
    ]);
    expect(result.skips).toEqual([]);
    expect(result.content).toMatchInlineSnapshot(`
      "class Broker {
          /**
           * Retries until the broker's per-key limit clears.
           */
          void retry() {}
      }"
    `);
  });
});

const FixtureFile = z.looseObject({
  comment: z.string(),
  kind: z.enum(["line", "block", "docstring"]) satisfies z.ZodType<CommentKind>,
  trimTo: z.string(),
  trimToLines: z.array(z.number()),
});

describe("migration-data-migration-mixed convention", () => {
  test("trimToLines:[2] keeps the genuine why line and drops the restatement", async () => {
    const fixture = FixtureFile.parse(
      JSON.parse(
        await Bun.file(
          join(
            import.meta.dirname,
            "..",
            "evals",
            "fixtures",
            "migration-data-migration-mixed.json",
          ),
        ).text(),
      ),
    );
    const [first = "", second = ""] = fixture.comment.split("\n");
    expect(fixture.comment.split("\n")).toHaveLength(2);
    expect(fixture.trimToLines).toEqual([2]);

    const source = [first, second, "op.execute()"].join("\n");
    const editItem = (over: Partial<Verdict>) =>
      item({
        startLine: 1,
        endLine: 2,
        startColumn: first.length - first.trimStart().length,
        endColumn: second.length,
        kind: fixture.kind,
        verdict: verdict(over),
      });

    for (const over of [{ trimToLines: fixture.trimToLines }, { trimTo: fixture.trimTo }]) {
      const result = computeFileEdits(source, [editItem(over)]);
      expect(result.content).toContain("Tool calls have tool_args");
      expect(result.content).not.toContain("Data migration: Convert");
    }
  });
});
