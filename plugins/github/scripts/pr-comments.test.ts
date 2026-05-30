import { describe, expect, it } from "bun:test";
import {
  type Comment,
  detectRole,
  filterThreads,
  findLastReviewDate,
  formatThreads,
  isBotThread,
  parseUrl,
  type Review,
  type Role,
  type Thread,
} from "./pr-comments";

function makeComment(login: string, date: string, body = "comment"): Comment {
  return {
    author: { login },
    body,
    createdAt: `${date}T00:00:00Z`,
  };
}

function makeThread(
  overrides: Omit<Partial<Thread>, "comments"> & { comments?: Comment[] } = {},
): Thread {
  const { comments, ...rest } = overrides;
  return {
    id: "PRRT_test",
    isResolved: false,
    isOutdated: false,
    path: "src/index.ts",
    line: 42,
    startLine: null,
    comments: { nodes: comments ?? [makeComment("reviewer", "2025-01-15")] },
    ...rest,
  };
}

function makeReview(login: string, date: string, state = "CHANGES_REQUESTED"): Review {
  return {
    author: { login, __typename: "User" },
    submittedAt: `${date}T00:00:00Z`,
    state,
  };
}

describe("parseUrl", () => {
  it("parses a valid GitHub PR URL", () => {
    const result = parseUrl("https://github.com/pydantic/pydantic-ai/pull/3772");
    expect(result).toEqual({ owner: "pydantic", repo: "pydantic-ai", number: 3772 });
  });

  it("parses PR URL with trailing path segments", () => {
    const result = parseUrl("https://github.com/owner/repo/pull/123/files");
    expect(result).toEqual({ owner: "owner", repo: "repo", number: 123 });
  });

  it("throws on non-PR GitHub URL", () => {
    expect(() => parseUrl("https://github.com/owner/repo/issues/123")).toThrow("Invalid PR URL");
  });

  it("throws on malformed URL", () => {
    expect(() => parseUrl("not-a-url")).toThrow();
  });
});

describe("detectRole", () => {
  it("returns author when viewer is the PR author", () => {
    expect(detectRole("bendrucker", "bendrucker")).toBe("author");
  });

  it("returns reviewer when viewer is not the PR author", () => {
    expect(detectRole("DouweM", "bendrucker")).toBe("reviewer");
  });
});

describe("filterThreads", () => {
  it("filters out resolved threads", () => {
    const threads = [makeThread({ isResolved: false }), makeThread({ isResolved: true })];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.isResolved).toBe(false);
  });

  it("filters to viewer's threads in reviewer role", () => {
    const threads = [
      makeThread({ comments: [makeComment("DouweM", "2025-01-15")] }),
      makeThread({ comments: [makeComment("bendrucker", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.comments.nodes[0]!.author?.login).toBe("DouweM");
  });

  it("shows all unresolved threads in author role", () => {
    const threads = [
      makeThread({ comments: [makeComment("DouweM", "2025-01-15")] }),
      makeThread({ comments: [makeComment("other-reviewer", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
    });
    expect(result).toHaveLength(2);
  });

  it("filters by since date", () => {
    const threads = [
      makeThread({ comments: [makeComment("DouweM", "2025-01-10")] }),
      makeThread({ comments: [makeComment("DouweM", "2025-01-20")] }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      since: new Date("2025-01-15T00:00:00Z"),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.comments.nodes[0]!.createdAt).toBe("2025-01-20T00:00:00Z");
  });

  it("excludes threads with null author in reviewer role", () => {
    const threads = [
      makeThread({
        comments: [{ author: null, body: "comment", createdAt: "2025-01-15T00:00:00Z" }],
      }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
    });
    expect(result).toHaveLength(0);
  });

  it("excludes threads with empty comments array", () => {
    const threads = [makeThread({ comments: [] })];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
    });
    expect(result).toHaveLength(0);
  });

  it("includes thread with comment at exactly the since date", () => {
    const threads = [makeThread({ comments: [makeComment("DouweM", "2025-01-15")] })];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      since: new Date("2025-01-15T00:00:00Z"),
    });
    expect(result).toHaveLength(1);
  });

  it("includes thread if any comment is after since date", () => {
    const threads = [
      makeThread({
        comments: [makeComment("DouweM", "2025-01-10"), makeComment("bendrucker", "2025-01-20")],
      }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      since: new Date("2025-01-15T00:00:00Z"),
    });
    expect(result).toHaveLength(1);
  });

  it("keeps only bot-opened threads with botsOnly", () => {
    const threads = [
      makeThread({ comments: [makeComment("coderabbitai[bot]", "2025-01-15")] }),
      makeThread({ comments: [makeComment("bendrucker", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      botsOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(isBotThread(result[0]!)).toBe(true);
  });

  it("keeps bot threads in reviewer role (botsOnly overrides opener filter)", () => {
    const threads = [
      makeThread({ comments: [makeComment("coderabbitai[bot]", "2025-01-15")] }),
      makeThread({ comments: [makeComment("DouweM", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
      botsOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(isBotThread(result[0]!)).toBe(true);
  });
});

describe("isBotThread", () => {
  it("classifies by the thread opener", () => {
    const bot = makeThread({ comments: [makeComment("greptileai", "2025-01-15")] });
    const human = makeThread({ comments: [makeComment("bob", "2025-01-15")] });
    expect(isBotThread(bot)).toBe(true);
    expect(isBotThread(human)).toBe(false);
  });
});

describe("findLastReviewDate", () => {
  it("finds the last review by a human non-viewer for author role", () => {
    const reviews = [
      makeReview("DouweM", "2025-01-10"),
      makeReview("DouweM", "2025-01-20"),
      makeReview("bendrucker", "2025-01-15"),
    ];
    const date = findLastReviewDate(reviews, "bendrucker", "author");
    expect(date).toEqual(new Date("2025-01-20T00:00:00Z"));
  });

  it("excludes bot reviews for author role", () => {
    const reviews = [
      makeReview("DouweM", "2025-01-20"),
      {
        author: { login: "devin-ai-integration[bot]", __typename: "Bot" },
        submittedAt: "2025-01-25T00:00:00Z",
        state: "COMMENTED",
      },
    ];
    const date = findLastReviewDate(reviews, "bendrucker", "author");
    expect(date).toEqual(new Date("2025-01-20T00:00:00Z"));
  });

  it("finds the viewer's last review for reviewer role", () => {
    const reviews = [
      makeReview("DouweM", "2025-01-10"),
      makeReview("DouweM", "2025-01-20"),
      makeReview("bendrucker", "2025-01-25"),
    ];
    const date = findLastReviewDate(reviews, "DouweM", "reviewer");
    expect(date).toEqual(new Date("2025-01-20T00:00:00Z"));
  });

  it("excludes reviews with null author", () => {
    const reviews: Review[] = [
      { author: null, submittedAt: "2025-01-25T00:00:00Z", state: "COMMENTED" },
      makeReview("DouweM", "2025-01-20"),
    ];
    const date = findLastReviewDate(reviews, "bendrucker", "author");
    expect(date).toEqual(new Date("2025-01-20T00:00:00Z"));
  });

  it("returns null when no relevant reviews exist", () => {
    const reviews = [makeReview("bendrucker", "2025-01-15")];
    const date = findLastReviewDate(reviews, "bendrucker", "author");
    expect(date).toBeNull();
  });
});

describe("findLastReviewDate + filterThreads", () => {
  it("includes threads from the review that defines the since cutoff", () => {
    const reviewDate = "2025-01-20";
    const reviews = [makeReview("DouweM", reviewDate)];
    const since = findLastReviewDate(reviews, "bendrucker", "author");

    const threads = [
      makeThread({ comments: [makeComment("DouweM", reviewDate)] }),
      makeThread({ comments: [makeComment("DouweM", "2025-01-10")] }),
    ];

    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      since: since!,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.comments.nodes[0]!.createdAt).toBe(`${reviewDate}T00:00:00Z`);
  });
});

describe("formatThreads", () => {
  const baseOptions = {
    title: "Add feature X",
    role: "author" as Role,
    viewer: "bendrucker",
  };

  it("formats empty result", () => {
    const output = formatThreads([], 10, baseOptions);
    expect(output).toContain("0 unresolved of 10 total threads");
    expect(output).toContain("No unresolved threads found.");
  });

  it("shows reviewer filter for reviewer role", () => {
    const output = formatThreads([], 10, {
      ...baseOptions,
      role: "reviewer",
      viewer: "DouweM",
    });
    expect(output).toContain("Showing threads started by @DouweM");
  });

  it("shows the bot header for botsOnly, not the reviewer-opener header", () => {
    const output = formatThreads([], 10, {
      ...baseOptions,
      role: "reviewer",
      viewer: "DouweM",
      botsOnly: true,
    });
    expect(output).toContain("Showing threads opened by AI review bots");
    expect(output).not.toContain("Showing threads started by");
  });

  it("groups threads by file", () => {
    const threads = [
      makeThread({ path: "src/a.ts", line: 10 }),
      makeThread({ path: "src/b.ts", line: 20 }),
      makeThread({ path: "src/a.ts", line: 30 }),
    ];
    const output = formatThreads(threads, 10, baseOptions);
    const aMatches = output.match(/## src\/a\.ts/g);
    expect(aMatches).toHaveLength(1);
    expect(output).toContain("## src/b.ts");
  });

  it("formats line ranges", () => {
    const threads = [makeThread({ startLine: 10, line: 20 })];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("Lines 10–20");
  });

  it("marks outdated threads", () => {
    const threads = [makeThread({ isOutdated: true })];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("(outdated)");
  });

  it("includes the thread id", () => {
    const threads = [makeThread({ id: "PRRT_abc123" })];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("`PRRT_abc123`");
  });

  it("marks bot-opened threads", () => {
    const threads = [makeThread({ comments: [makeComment("coderabbitai[bot]", "2025-01-15")] })];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("(bot)");
  });

  it("formats comment bodies as blockquotes", () => {
    const threads = [
      makeThread({
        comments: [makeComment("DouweM", "2025-01-15", "Fix this\nand that")],
      }),
    ];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("> Fix this\n> and that");
  });

  it("renders file-level thread", () => {
    const threads = [makeThread({ line: null, startLine: null })];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("### File-level");
  });

  it("renders null author as ghost", () => {
    const threads = [
      makeThread({
        comments: [{ author: null, body: "feedback", createdAt: "2025-01-15T00:00:00Z" }],
      }),
    ];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("**@ghost**");
  });

  it("includes author and date on comments", () => {
    const threads = [
      makeThread({
        comments: [makeComment("DouweM", "2025-01-15", "looks good")],
      }),
    ];
    const output = formatThreads(threads, 1, baseOptions);
    expect(output).toContain("**@DouweM** (2025-01-15):");
  });
});
