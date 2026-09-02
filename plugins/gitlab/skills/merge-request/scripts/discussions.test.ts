import { describe, expect, it, test } from "bun:test";
import type { DiscussionSummary, FilterOptions } from "./discussions";
import {
  deduplicateDiscussions,
  Discussion,
  filterDiscussions,
  formatDigest,
  formatLocation,
  truncateBody,
} from "./discussions";

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    author: { username: "reviewer" },
    body: "Needs work",
    resolvable: true,
    resolved: false,
    ...overrides,
  };
}

function makeDiscussion(id: string, noteOverrides: Record<string, unknown> = {}): Discussion {
  return { id, notes: [makeNote(noteOverrides)] };
}

describe("filterDiscussions", () => {
  test.each<{ name: string; discussions: Discussion[]; options: FilterOptions; ids: string[] }>([
    {
      name: "filters by author",
      discussions: [
        makeDiscussion("1", { author: { username: "alice" } }),
        makeDiscussion("2", { author: { username: "bob" } }),
      ],
      options: { author: "alice" },
      ids: ["1"],
    },
    {
      name: "filters resolvable only",
      discussions: [
        makeDiscussion("1", { resolvable: true }),
        makeDiscussion("2", { resolvable: false }),
      ],
      options: { resolvable: true },
      ids: ["1"],
    },
    {
      name: "filters unresolved only",
      discussions: [
        makeDiscussion("1", { resolved: false }),
        makeDiscussion("2", { resolved: true }),
      ],
      options: { unresolved: true },
      ids: ["1"],
    },
    {
      name: "combines filters",
      discussions: [
        makeDiscussion("1", { author: { username: "alice" }, resolved: false }),
        makeDiscussion("2", { author: { username: "alice" }, resolved: true }),
        makeDiscussion("3", { author: { username: "bob" }, resolved: false }),
      ],
      options: { author: "alice", unresolved: true },
      ids: ["1"],
    },
    {
      name: "keeps structural bots and listed reviewers with bots",
      discussions: [
        makeDiscussion("1", {
          author: { username: "group_108656794_bot_52b7e4c7a732080fa3b51efe36863e09" },
        }),
        makeDiscussion("2", { author: { username: "coderabbitai" } }),
        makeDiscussion("3", { author: { username: "alice" } }),
      ],
      options: { bots: true, extra: new Set(["coderabbitai"]) },
      ids: ["1", "2"],
    },
    {
      name: "skips discussions with empty notes",
      discussions: [{ id: "1", notes: [] }],
      options: {},
      ids: [],
    },
  ])("$name", ({ discussions, options, ids }) => {
    const result = filterDiscussions(discussions, options);
    expect(result.map((d) => d.id)).toEqual(ids);
  });
});

describe("deduplicateDiscussions", () => {
  test.each<{ name: string; discussions: Discussion[]; ids: string[] }>([
    {
      name: "removes duplicates with same path and body prefix",
      discussions: [
        makeDiscussion("1", { body: "Fix this issue", position: { new_path: "src/app.ts" } }),
        makeDiscussion("2", { body: "Fix this issue", position: { new_path: "src/app.ts" } }),
      ],
      ids: ["1"],
    },
    {
      name: "keeps discussions with different paths",
      discussions: [
        makeDiscussion("1", { body: "Fix this", position: { new_path: "src/a.ts" } }),
        makeDiscussion("2", { body: "Fix this", position: { new_path: "src/b.ts" } }),
      ],
      ids: ["1", "2"],
    },
    {
      name: "keeps discussions with different body prefixes",
      discussions: [
        makeDiscussion("1", { body: "First comment", position: { new_path: "src/a.ts" } }),
        makeDiscussion("2", { body: "Second comment", position: { new_path: "src/a.ts" } }),
      ],
      ids: ["1", "2"],
    },
    {
      name: "skips discussions with empty notes",
      discussions: [{ id: "1", notes: [] }],
      ids: [],
    },
  ])("$name", ({ discussions, ids }) => {
    const result = deduplicateDiscussions(discussions);
    expect(result.map((d) => d.id)).toEqual(ids);
  });
});

function makeSummary(overrides: Partial<DiscussionSummary> = {}): DiscussionSummary {
  return {
    id: "abcdef0123456789",
    author: "reviewer",
    body: "Needs work",
    resolved: false,
    resolvable: true,
    lineRange: null,
    ...overrides,
  };
}

describe("truncateBody", () => {
  test.each<{ name: string; body: string; max: number; expected: string }>([
    {
      name: "collapses whitespace and newlines to single spaces",
      body: "a\n  b\t c",
      max: 80,
      expected: "a b c",
    },
    {
      name: "truncates with an ellipsis past the max",
      body: "abcdefghij",
      max: 5,
      expected: "abcd…",
    },
    { name: "leaves short bodies untouched", body: "short", max: 80, expected: "short" },
  ])("$name", ({ body, max, expected }) => {
    expect(truncateBody(body, max)).toBe(expected);
  });
});

describe("formatLocation", () => {
  test.each<{ name: string; summary: DiscussionSummary; expected: string }>([
    {
      name: "returns empty string for non-positioned discussions",
      summary: makeSummary(),
      expected: "",
    },
    {
      name: "renders file:line for single-line comments",
      summary: makeSummary({ file: "src/app.ts", line: 42 }),
      expected: "src/app.ts:42",
    },
    {
      name: "renders file:start-end for ranges",
      summary: makeSummary({ file: "src/app.ts", lineRange: { start: 10, end: 14 } }),
      expected: "src/app.ts:10-14",
    },
  ])("$name", ({ summary, expected }) => {
    expect(formatLocation(summary)).toBe(expected);
  });
});

describe("formatDigest", () => {
  it("emits one line per discussion with id, location, state, and body", () => {
    const out = formatDigest(
      [
        makeSummary({ id: "111111111111aaaa", file: "src/app.ts", line: 42, body: "Extract this" }),
        makeSummary({ id: "222222222222bbbb", resolved: true, body: "Nit: typo" }),
      ],
      80,
    );
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toMatchInlineSnapshot(`
      "111111111111  src/app.ts:42  [open]      Extract this
      222222222222  -              [resolved]  Nit: typo"
    `);
  });

  it("truncates bodies to the given width", () => {
    expect(formatDigest([makeSummary({ body: "x".repeat(200) })], 20)).toMatchInlineSnapshot(
      `"abcdef012345  -  [open]  xxxxxxxxxxxxxxxxxxx…"`,
    );
  });

  it("returns an empty string with no discussions", () => {
    expect(formatDigest([], 80)).toBe("");
  });
});

describe("null notes tolerance", () => {
  const degenerate: Discussion[] = [
    { id: "null-notes", notes: null },
    { id: "missing-notes" },
    { id: "empty-notes", notes: [] },
    makeDiscussion("real"),
  ];

  it("filterDiscussions drops discussions without notes", () => {
    expect(filterDiscussions(degenerate, {}).map((d) => d.id)).toEqual(["real"]);
  });

  it("deduplicateDiscussions skips discussions without notes", () => {
    expect(deduplicateDiscussions(degenerate).map((d) => d.id)).toEqual(["real"]);
  });
});

describe("null position fields", () => {
  // GitLab nulls the side of a position that does not exist: old_line and
  // old_path on a purely added line, new_line and new_path on a deleted one.
  // Requiring numbers there rejected every thread on an added line.
  test.each<{ name: string; position: Record<string, unknown> }>([
    {
      name: "added line",
      position: { old_line: null, new_line: 42, old_path: null, new_path: "src/a.ts" },
    },
    {
      name: "deleted line",
      position: { old_line: 42, new_line: null, old_path: "src/a.ts", new_path: null },
    },
  ])("parses a position on an $name", ({ position }) => {
    const parsed = Discussion.parse({ id: "1", notes: [makeNote({ position })] });
    expect(parsed.notes?.[0]?.position).toMatchObject(position);
  });

  it("parses a line_range whose ends null the absent side", () => {
    const parsed = Discussion.parse({
      id: "1",
      notes: [
        makeNote({
          position: {
            new_path: "src/a.ts",
            old_path: null,
            new_line: 10,
            old_line: null,
            line_range: {
              start: { type: "new", new_line: 10, old_line: null },
              end: { type: "new", new_line: 12, old_line: null },
            },
          },
        }),
      ],
    });
    expect(parsed.notes?.[0]?.position?.line_range?.start.new_line).toBe(10);
  });
});
