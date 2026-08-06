import { describe, expect, test } from "bun:test";
import type { CommentKind } from "../detection/types";
import { type CommentStyle, conformToStyle, detectStyle } from "./comment-syntax";
import type { EditItem } from "./edits";

/**
 * A span covering whole lines of `source`, the shape `detectStyle` reads. The
 * columns bracket the comment exactly, as the extractor produces them.
 */
function span(source: string, kind: CommentKind = "line"): { lines: string[]; item: EditItem } {
  const lines = source.split("\n");
  const first = lines[0] as string;
  const last = lines[lines.length - 1] as string;
  return {
    lines,
    item: {
      startLine: 1,
      endLine: lines.length,
      startColumn: first.length - first.trimStart().length,
      endColumn: last.length,
      kind,
      verdict: {
        action: "trim",
        category: "restate-the-what",
        confidence: "high",
        rationale: "r",
        rewrite: null,
      },
    },
  };
}

describe("detectStyle", () => {
  test.each<{
    name: string;
    source: string;
    kind?: CommentKind | undefined;
    expected: CommentStyle;
  }>([
    {
      name: "javadoc block keeps its star continuation",
      source: "/**\n * one\n * two\n */",
      kind: "docstring",
      expected: { form: "block", open: "/**", close: "*/", continuation: "*" },
    },
    {
      name: "plain block without stars has no continuation",
      source: "/* one\n   two */",
      kind: "block",
      expected: { form: "block", open: "/*", close: "*/", continuation: undefined },
    },
    {
      name: "plain block with stars picks up the continuation",
      source: "/*\n * one\n */",
      kind: "block",
      expected: { form: "block", open: "/*", close: "*/", continuation: "*" },
    },
    {
      name: "python docstring",
      source: '"""\nDoes a thing.\n"""',
      kind: "docstring",
      expected: { form: "block", open: '"""', close: '"""', continuation: undefined },
    },
    {
      name: "slash run",
      source: "// one\n// two",
      expected: { form: "line", linePrefix: "//" },
    },
    {
      name: "rust outer doc run is not read as a plain slash run",
      source: "/// one\n/// two",
      expected: { form: "line", linePrefix: "///" },
    },
    {
      name: "rust inner doc run is not read as a plain slash run",
      source: "//! one",
      expected: { form: "line", linePrefix: "//!" },
    },
    { name: "hash run", source: "# one", expected: { form: "line", linePrefix: "#" } },
    { name: "sql run", source: "-- one", expected: { form: "line", linePrefix: "--" } },
    {
      name: "unrecognized markers fall back to the kind with no delimiters",
      source: "(* ocaml *)",
      kind: "block",
      expected: { form: "block" },
    },
  ])("$name", ({ source, kind, expected }) => {
    const { lines, item } = span(source, kind);
    expect(detectStyle(lines, item)).toEqual(expected);
  });

  test("reads the comment out of a trailing span, not the code before it", () => {
    const source = "count += 1; # bumps it";
    const item = span(source).item;
    expect(detectStyle([source], { ...item, startColumn: 12 })).toEqual({
      form: "line",
      linePrefix: "#",
    });
  });
});

describe("conformToStyle", () => {
  const javadoc: CommentStyle = { form: "block", open: "/**", close: "*/", continuation: "*" };
  const pydoc: CommentStyle = { form: "block", open: '"""', close: '"""' };
  const slash: CommentStyle = { form: "line", linePrefix: "//" };
  const hash: CommentStyle = { form: "line", linePrefix: "#" };

  test.each<{ name: string; text: string; style: CommentStyle; expected: string | null }>([
    {
      name: "javadoc text passes through unchanged",
      text: "/**\n * Returns the path.\n */",
      style: javadoc,
      expected: "/**\n * Returns the path.\n */",
    },
    {
      name: "bare prose gets javadoc delimiters on one line",
      text: "The broker rate-limits per key.",
      style: javadoc,
      expected: "/** The broker rate-limits per key. */",
    },
    {
      name: "multi-line bare prose gets star continuations",
      text: "The broker rate-limits per key.\nRetries reuse the first backoff.",
      style: javadoc,
      expected: "/**\n * The broker rate-limits per key.\n * Retries reuse the first backoff.\n */",
    },
    {
      name: "a blank interior line keeps its continuation marker unpadded",
      text: "One.\n\nTwo.",
      style: javadoc,
      expected: "/**\n * One.\n *\n * Two.\n */",
    },
    {
      name: "bare prose in a python docstring site skips continuations",
      text: "One.\nTwo.",
      style: pydoc,
      expected: '"""\nOne.\nTwo.\n"""',
    },
    {
      name: "bare prose gets a slash prefix on every line",
      text: "Retries reuse the first backoff.\nThe broker rate-limits per key.",
      style: slash,
      expected: "// Retries reuse the first backoff.\n// The broker rate-limits per key.",
    },
    {
      name: "bare prose gets a hash prefix",
      text: "Rate-limited per key.",
      style: hash,
      expected: "# Rate-limited per key.",
    },
    {
      name: "over-indented javadoc text loses its common prefix",
      text: "    /**\n     * Returns the path.\n     */",
      style: javadoc,
      expected: "/**\n * Returns the path.\n */",
    },
    {
      name: "over-indented line text loses its common prefix",
      text: "    // reuses the shared backoff",
      style: slash,
      expected: "// reuses the shared backoff",
    },
    {
      name: "a slash comment landing in a javadoc site is irreconcilable",
      text: "// Returns the path.",
      style: javadoc,
      expected: null,
    },
    {
      name: "a hash comment landing in a slash site is irreconcilable",
      text: "# Returns the path.",
      style: slash,
      expected: null,
    },
    {
      name: "a python docstring landing in a javadoc site is irreconcilable",
      text: '"""Returns the path."""',
      style: javadoc,
      expected: null,
    },
    {
      name: "a plain block is accepted at a javadoc site",
      text: "/* Returns the path. */",
      style: javadoc,
      expected: "/* Returns the path. */",
    },
    {
      name: "bare prose at a rust doc site keeps the doc marker",
      text: "Retries reuse the first backoff.",
      style: { form: "line", linePrefix: "///" },
      expected: "/// Retries reuse the first backoff.",
    },
    {
      name: "a plain slash comment landing in a rust doc site is irreconcilable",
      text: "// Retries reuse the first backoff.",
      style: { form: "line", linePrefix: "///" },
      expected: null,
    },
    {
      name: "a block site with no known delimiters cannot be conformed",
      text: "Returns the path.",
      style: { form: "block" },
      expected: null,
    },
    {
      name: "a line site with no known delimiters cannot be conformed",
      text: "Returns the path.",
      style: { form: "line" },
      expected: null,
    },
    {
      name: "delimiter-carrying text is still refused at a site with none",
      text: "// Returns the path.",
      style: { form: "line" },
      expected: null,
    },
  ])("$name", ({ text, style, expected }) => {
    expect(conformToStyle(text, style)).toBe(expected);
  });
});
