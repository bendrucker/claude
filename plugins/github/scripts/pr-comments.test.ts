import { describe, expect, it, test } from "bun:test";
import {
  type Comment,
  detectRole,
  resolveRole,
  filterThreads,
  findLastReviewDate,
  formatThreads,
  isBotThread,
  parseUrl,
  type Review,
  type Role,
  type Thread,
} from "./pr-comments";

function makeComment(login: string, date: string, body = "comment", typename = "User"): Comment {
  return {
    author: { login, __typename: typename },
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
  test.each<[string, { owner: string; repo: string; number: number }]>([
    [
      "https://github.com/pydantic/pydantic-ai/pull/3772",
      { owner: "pydantic", repo: "pydantic-ai", number: 3772 },
    ],
    ["https://github.com/owner/repo/pull/123/files", { owner: "owner", repo: "repo", number: 123 }],
  ])("parses %p", (url, expected) => {
    expect(parseUrl(url)).toEqual(expected);
  });

  it("throws on non-PR GitHub URL", () => {
    expect(() => parseUrl("https://github.com/owner/repo/issues/123")).toThrow("Invalid PR URL");
  });

  it("throws on malformed URL", () => {
    expect(() => parseUrl("not-a-url")).toThrow();
  });
});

describe("detectRole", () => {
  test.each<[string, string, Role]>([
    ["bendrucker", "bendrucker", "author"],
    ["DouweM", "bendrucker", "reviewer"],
  ])("detectRole(viewer=%p, author=%p) -> %p", (viewer, author, expected) => {
    expect(detectRole(viewer, author)).toBe(expected);
  });
});

describe("resolveRole", () => {
  test.each<[string | undefined, Role | null]>([
    ["author", "author"],
    ["reviewer", "reviewer"],
    [undefined, "reviewer"],
    ["", "reviewer"],
    ["bogus", null],
  ])("resolveRole(flag=%p) -> %p", (flag, expected) => {
    expect(resolveRole(flag, "DouweM", "bendrucker")).toBe(expected);
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

  it("keeps only review-target threads with bots", () => {
    const threads = [
      makeThread({ comments: [makeComment("copilot", "2025-01-15", "comment", "Bot")] }),
      makeThread({ comments: [makeComment("bendrucker", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      bots: true,
    });
    expect(result).toHaveLength(1);
    expect(isBotThread(result[0]!)).toBe(true);
  });

  it("includes opted-in reviewers from extra with bots", () => {
    const threads = [
      makeThread({ comments: [makeComment("jacob", "2025-01-15")] }),
      makeThread({ comments: [makeComment("bendrucker", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "author",
      viewer: "bendrucker",
      bots: true,
      extra: new Set(["jacob"]),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.comments.nodes[0]!.author?.login).toBe("jacob");
  });

  it("keeps the viewer's resolved threads with includeResolved in reviewer role", () => {
    const threads = [
      makeThread({ isResolved: true, comments: [makeComment("DouweM", "2025-01-15")] }),
      makeThread({ isResolved: true, comments: [makeComment("bendrucker", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
      includeResolved: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.comments.nodes[0]!.author?.login).toBe("DouweM");
    expect(result[0]!.isResolved).toBe(true);
  });

  it("drops resolved threads by default when the flag is unset", () => {
    const threads = [
      makeThread({ isResolved: true, comments: [makeComment("DouweM", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
    });
    expect(result).toHaveLength(0);
  });

  it("keeps review-target threads in reviewer role (bots overrides opener filter)", () => {
    const threads = [
      makeThread({ comments: [makeComment("copilot", "2025-01-15", "comment", "Bot")] }),
      makeThread({ comments: [makeComment("DouweM", "2025-01-15")] }),
    ];
    const result = filterThreads(threads, {
      role: "reviewer",
      viewer: "DouweM",
      bots: true,
    });
    expect(result).toHaveLength(1);
    expect(isBotThread(result[0]!)).toBe(true);
  });
});

describe("isBotThread", () => {
  it("classifies by the thread opener's API type", () => {
    const bot = makeThread({
      comments: [makeComment("greptile-apps", "2025-01-15", "comment", "Bot")],
    });
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

  const cases: {
    name: string;
    threads: Thread[];
    total: number;
    options: Parameters<typeof formatThreads>[2];
  }[] = [
    { name: "empty result", threads: [], total: 10, options: baseOptions },
    {
      name: "reviewer-opener header",
      threads: [],
      total: 10,
      options: { ...baseOptions, role: "reviewer", viewer: "DouweM" },
    },
    {
      name: "bot header",
      threads: [],
      total: 10,
      options: { ...baseOptions, role: "reviewer", viewer: "DouweM", bots: true },
    },
    {
      name: "grouped by file",
      threads: [
        makeThread({ path: "src/a.ts", line: 10 }),
        makeThread({ path: "src/b.ts", line: 20 }),
        makeThread({ path: "src/a.ts", line: 30 }),
      ],
      total: 10,
      options: baseOptions,
    },
    {
      name: "line range",
      threads: [makeThread({ startLine: 10, line: 20 })],
      total: 1,
      options: baseOptions,
    },
    {
      name: "outdated thread",
      threads: [makeThread({ isOutdated: true })],
      total: 1,
      options: baseOptions,
    },
    {
      name: "thread id",
      threads: [makeThread({ id: "PRRT_abc123" })],
      total: 1,
      options: baseOptions,
    },
    {
      name: "bot-opened thread",
      threads: [
        makeThread({ comments: [makeComment("coderabbitai", "2025-01-15", "comment", "Bot")] }),
      ],
      total: 1,
      options: baseOptions,
    },
    {
      name: "multi-line blockquote body",
      threads: [
        makeThread({ comments: [makeComment("DouweM", "2025-01-15", "Fix this\nand that")] }),
      ],
      total: 1,
      options: baseOptions,
    },
    {
      name: "file-level thread",
      threads: [makeThread({ line: null, startLine: null })],
      total: 1,
      options: baseOptions,
    },
    {
      name: "ghost author",
      threads: [
        makeThread({
          comments: [{ author: null, body: "feedback", createdAt: "2025-01-15T00:00:00Z" }],
        }),
      ],
      total: 1,
      options: baseOptions,
    },
    {
      name: "author and date",
      threads: [makeThread({ comments: [makeComment("DouweM", "2025-01-15", "looks good")] })],
      total: 1,
      options: baseOptions,
    },
  ];

  it.each(cases)("$name", ({ threads, total, options }) => {
    expect(formatThreads(threads, total, options)).toMatchSnapshot();
  });

  it("suppresses the reviewer-opener header when showing bot threads", () => {
    const output = formatThreads([], 10, {
      ...baseOptions,
      role: "reviewer",
      viewer: "DouweM",
      bots: true,
    });
    expect(output).not.toContain("Showing threads started by");
  });

  it("tags resolved threads and counts them with includeResolved", () => {
    const output = formatThreads(
      [makeThread({ isResolved: true }), makeThread({ isResolved: false })],
      2,
      { ...baseOptions, includeResolved: true },
    );
    expect(output).toContain("(resolved)");
    expect(output).toContain("2 of 2 total threads (1 resolved)");
  });

  it("omits the resolved tag and count without includeResolved", () => {
    const output = formatThreads([makeThread({ isResolved: false })], 2, baseOptions);
    expect(output).not.toContain("(resolved)");
    expect(output).toContain("1 unresolved of 2 total threads");
  });

  it("collapses repeated files under a single header", () => {
    const output = formatThreads(
      [
        makeThread({ path: "src/a.ts", line: 10 }),
        makeThread({ path: "src/b.ts", line: 20 }),
        makeThread({ path: "src/a.ts", line: 30 }),
      ],
      10,
      baseOptions,
    );
    expect(output.match(/## src\/a\.ts/g)).toHaveLength(1);
  });
});
