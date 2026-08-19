import { describe, expect, test } from "bun:test";
import { mergeTags, parseTags, resolveTags, type TagResolution } from "./tags";

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

describe("resolveTags", () => {
  const existing = ["claude", "review", "Work"];

  test.each<{ name: string; requested: string[]; expected: TagResolution }>([
    {
      name: "passes through a known tag",
      requested: ["review"],
      expected: { resolved: ["review"], unknown: [] },
    },
    {
      name: "remaps to the casing Things stores",
      requested: ["CLAUDE", "work"],
      expected: { resolved: ["claude", "Work"], unknown: [] },
    },
    {
      name: "collapses spellings that differ only in case",
      requested: ["claude", "Claude"],
      expected: { resolved: ["claude"], unknown: [] },
    },
    {
      name: "names a tag Things does not hold",
      requested: ["review", "bug"],
      expected: { resolved: ["review"], unknown: ["bug"] },
    },
    {
      name: "reports an unknown tag once",
      requested: ["bug", "BUG"],
      expected: { resolved: [], unknown: ["bug"] },
    },
    {
      name: "keeps requested order",
      requested: ["Work", "claude"],
      expected: { resolved: ["Work", "claude"], unknown: [] },
    },
    { name: "handles no request", requested: [], expected: { resolved: [], unknown: [] } },
  ])("$name", ({ requested, expected }) => {
    expect(resolveTags(requested, existing)).toEqual(expected);
  });

  test("rejects everything when Things holds no tags", () => {
    expect(resolveTags(["claude"], [])).toEqual({ resolved: [], unknown: ["claude"] });
  });
});
