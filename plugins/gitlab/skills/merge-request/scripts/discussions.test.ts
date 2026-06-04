import { describe, expect, it } from "bun:test";
import type { Discussion, DiscussionSummary } from "./discussions";
import {
  deduplicateDiscussions,
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
  it("filters by author", () => {
    const discussions = [
      makeDiscussion("1", { author: { username: "alice" } }),
      makeDiscussion("2", { author: { username: "bob" } }),
    ];
    const result = filterDiscussions(discussions, { author: "alice" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("filters resolvable only", () => {
    const discussions = [
      makeDiscussion("1", { resolvable: true }),
      makeDiscussion("2", { resolvable: false }),
    ];
    const result = filterDiscussions(discussions, { resolvable: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("filters unresolved only", () => {
    const discussions = [
      makeDiscussion("1", { resolved: false }),
      makeDiscussion("2", { resolved: true }),
    ];
    const result = filterDiscussions(discussions, { unresolved: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("combines filters", () => {
    const discussions = [
      makeDiscussion("1", { author: { username: "alice" }, resolved: false }),
      makeDiscussion("2", { author: { username: "alice" }, resolved: true }),
      makeDiscussion("3", { author: { username: "bob" }, resolved: false }),
    ];
    const result = filterDiscussions(discussions, { author: "alice", unresolved: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("keeps structural bots and listed reviewers with bots", () => {
    const discussions = [
      makeDiscussion("1", { author: { username: "group_123_bot" } }),
      makeDiscussion("2", { author: { username: "coderabbitai" } }),
      makeDiscussion("3", { author: { username: "alice" } }),
    ];
    const result = filterDiscussions(discussions, {
      bots: true,
      extra: new Set(["coderabbitai"]),
    });
    expect(result.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("skips discussions with empty notes", () => {
    const discussions: Discussion[] = [{ id: "1", notes: [] }];
    const result = filterDiscussions(discussions, {});
    expect(result).toHaveLength(0);
  });
});

describe("deduplicateDiscussions", () => {
  it("removes duplicates with same path and body prefix", () => {
    const discussions = [
      makeDiscussion("1", {
        body: "Fix this issue",
        position: { new_path: "src/app.ts" },
      }),
      makeDiscussion("2", {
        body: "Fix this issue",
        position: { new_path: "src/app.ts" },
      }),
    ];
    const result = deduplicateDiscussions(discussions);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("keeps discussions with different paths", () => {
    const discussions = [
      makeDiscussion("1", {
        body: "Fix this",
        position: { new_path: "src/a.ts" },
      }),
      makeDiscussion("2", {
        body: "Fix this",
        position: { new_path: "src/b.ts" },
      }),
    ];
    const result = deduplicateDiscussions(discussions);
    expect(result).toHaveLength(2);
  });

  it("keeps discussions with different body prefixes", () => {
    const discussions = [
      makeDiscussion("1", {
        body: "First comment",
        position: { new_path: "src/a.ts" },
      }),
      makeDiscussion("2", {
        body: "Second comment",
        position: { new_path: "src/a.ts" },
      }),
    ];
    const result = deduplicateDiscussions(discussions);
    expect(result).toHaveLength(2);
  });

  it("skips discussions with empty notes", () => {
    const discussions: Discussion[] = [{ id: "1", notes: [] }];
    const result = deduplicateDiscussions(discussions);
    expect(result).toHaveLength(0);
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
  it("collapses whitespace and newlines to single spaces", () => {
    expect(truncateBody("a\n  b\t c", 80)).toBe("a b c");
  });

  it("truncates with an ellipsis past the max", () => {
    const result = truncateBody("abcdefghij", 5);
    expect(result).toBe("abcd…");
    expect(result).toHaveLength(5);
  });

  it("leaves short bodies untouched", () => {
    expect(truncateBody("short", 80)).toBe("short");
  });
});

describe("formatLocation", () => {
  it("returns empty string for non-positioned discussions", () => {
    expect(formatLocation(makeSummary())).toBe("");
  });

  it("renders file:line for single-line comments", () => {
    expect(formatLocation(makeSummary({ file: "src/app.ts", line: 42 }))).toBe("src/app.ts:42");
  });

  it("renders file:start-end for ranges", () => {
    expect(
      formatLocation(makeSummary({ file: "src/app.ts", lineRange: { start: 10, end: 14 } })),
    ).toBe("src/app.ts:10-14");
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
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("111111111111");
    expect(lines[0]).toContain("src/app.ts:42");
    expect(lines[0]).toContain("[open]");
    expect(lines[0]).toContain("Extract this");
    expect(lines[1]).toContain("[resolved]");
    expect(lines[1]).toContain("-");
  });

  it("truncates bodies to the given width", () => {
    const out = formatDigest([makeSummary({ body: "x".repeat(200) })], 20);
    expect(out).toContain(`${"x".repeat(19)}…`);
    expect(out).not.toContain("x".repeat(21));
  });

  it("returns an empty string with no discussions", () => {
    expect(formatDigest([], 80)).toBe("");
  });
});
