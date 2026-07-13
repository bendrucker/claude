import { describe, expect, test } from "bun:test";
import { mergeTags, parseTags } from "./tags";

describe("parseTags", () => {
  test.each<{ name: string; input: string | undefined; expected: string[] }>([
    { name: "undefined", input: undefined, expected: [] },
    { name: "empty string", input: "", expected: [] },
    { name: "single tag", input: "claude-code", expected: ["claude-code"] },
    { name: "comma-separated tags", input: "claude-code,work", expected: ["claude-code", "work"] },
    { name: "trims whitespace", input: " claude-code , work ", expected: ["claude-code", "work"] },
    {
      name: "filters empty segments",
      input: "claude-code,,work",
      expected: ["claude-code", "work"],
    },
  ])("$name", ({ input, expected }) => {
    expect(parseTags(input)).toEqual(expected);
  });
});

describe("mergeTags", () => {
  test.each<{ name: string; sources: string[][]; expected: string[] }>([
    { name: "returns single source as-is", sources: [["Claude"]], expected: ["Claude"] },
    {
      name: "combines multiple sources",
      sources: [["Claude"], ["work"]],
      expected: ["Claude", "work"],
    },
    {
      name: "deduplicates across sources",
      sources: [["Claude"], ["Claude", "work"]],
      expected: ["Claude", "work"],
    },
    {
      name: "preserves insertion order",
      sources: [["Claude", "claude-code"], ["work"]],
      expected: ["Claude", "claude-code", "work"],
    },
    { name: "handles empty sources", sources: [[], ["Claude"]], expected: ["Claude"] },
  ])("$name", ({ sources, expected }) => {
    expect(mergeTags(...sources)).toEqual(expected);
  });
});
