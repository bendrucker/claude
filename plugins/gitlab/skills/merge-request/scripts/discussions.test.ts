import { describe, expect, it } from "bun:test";
import type { Discussion } from "./discussions";
import { deduplicateDiscussions, filterDiscussions, parseGlabPaginated } from "./discussions";

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

describe("parseGlabPaginated", () => {
  it("parses a single page", () => {
    const result = parseGlabPaginated('[{"id": 1}]');
    expect(result).toEqual([{ id: 1 }]);
  });

  it("fixes concatenated pages", () => {
    const result = parseGlabPaginated('[{"id": 1}][{"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles whitespace between pages", () => {
    const result = parseGlabPaginated('[{"id": 1}]\n[{"id": 2}]');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("handles three concatenated pages", () => {
    const result = parseGlabPaginated('[{"a":1}][{"b":2}][{"c":3}]');
    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("preserves arrays inside objects", () => {
    const result = parseGlabPaginated('[{"notes": [1, 2]}]');
    expect(result).toEqual([{ notes: [1, 2] }]);
  });
});

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
