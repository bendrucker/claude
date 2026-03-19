import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mapConcurrent } from "./concurrent";
import { parseDate } from "./date";
import { streamSessionFiles } from "./files";
import { formatDigest, formatSearchResults, formatStats } from "./format";
import { parseConversationFile } from "./parse";
import { getDigest, searchConversations } from "./query";
import { calculateRelevanceScore } from "./score";
import { getStats } from "./stats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures", "sessions");
const projectDir = path.join(fixturesDir, "-Users-test-project");

describe("parseConversationFile", () => {
  it("parses basic JSONL session", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.sessionId).toBe("basic-session");
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]?.role).toBe("user");
    expect(conv.messages[1]?.role).toBe("assistant");
  });

  it("extracts project metadata", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.projectPath).toBe("/Users/test/project");
    expect(conv.gitBranch).toBe("main");
  });

  it("extracts timestamps", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.startTime).toEqual(new Date("2024-01-15T10:00:00.000Z"));
    expect(conv.endTime).toEqual(new Date("2024-01-15T10:01:00.000Z"));
  });

  it("computes durationMinutes from timestamps", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.durationMinutes).toBe(1);
  });

  it("extracts projectName from projectPath", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.projectName).toBe("project");
  });

  it("extracts tool uses from assistant messages", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "tools.jsonl"));
    const toolUses = conv.messages.flatMap((m) => m.toolUses);
    expect(toolUses).toHaveLength(3);
    expect(toolUses.some((t) => t.name === "Bash")).toBe(true);
    expect(toolUses.some((t) => t.name === "Read")).toBe(true);
    expect(toolUses.some((t) => t.name === "Edit")).toBe(true);
  });

  it("extracts summary when present", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "summary.jsonl"));
    expect(conv.summary).toBe(
      "Fixed database connection pooling issue causing timeouts under load",
    );
  });

  it("handles sessions without summary", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.summary).toBeNull();
  });

  it("skips malformed JSON lines and parses valid ones", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "malformed.jsonl"));
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]?.content).toContain("Valid message");
  });

  it("returns null projectPath when not present", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "malformed.jsonl"));
    expect(conv.projectPath).toBe("/Users/test/malformed");
  });
});

describe("calculateRelevanceScore", () => {
  it("returns zero for empty query", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    const { score } = calculateRelevanceScore("", conv);
    expect(score).toBe(0);
  });

  it("weights summaries 3x higher", async () => {
    const convWithSummary = await parseConversationFile(path.join(projectDir, "summary.jsonl"));
    const convWithoutSummary = await parseConversationFile(path.join(projectDir, "basic.jsonl"));

    const summaryScore = calculateRelevanceScore("database", convWithSummary);
    const noSummaryScore = calculateRelevanceScore("database", convWithoutSummary);

    expect(summaryScore.score).toBeGreaterThan(noSummaryScore.score);
  });

  it("boosts user messages over assistant messages", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "multiple.jsonl"));
    // "refactor" appears in user message
    const { score } = calculateRelevanceScore("refactor", conv);
    expect(score).toBeGreaterThan(0);
  });

  it("includes tool results in scoring", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "tool-results.jsonl"));
    const { score, matchedContent } = calculateRelevanceScore("OOMKilled", conv);
    expect(score).toBeGreaterThan(0);
    expect(matchedContent.some((m) => m.startsWith("Result:"))).toBe(true);
  });

  it("ranks tool result matches lower than user message matches", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "tool-results.jsonl"));
    const resultScore = calculateRelevanceScore("OOMKilled", conv).score;
    const userScore = calculateRelevanceScore("deployment", conv).score;
    expect(userScore).toBeGreaterThan(resultScore);
  });

  it("includes tool uses in scoring", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "tools.jsonl"));
    const { score, matchedContent } = calculateRelevanceScore("Bash npm", conv);
    expect(score).toBeGreaterThan(0);
    expect(matchedContent.some((m) => m.includes("Tool:"))).toBe(true);
  });

  it("returns matched content previews", async () => {
    const conv = await parseConversationFile(path.join(projectDir, "basic.jsonl"));
    const { matchedContent } = calculateRelevanceScore("error", conv);
    expect(matchedContent.length).toBeGreaterThan(0);
    expect(matchedContent.some((m) => m.includes("user:") || m.includes("assistant:"))).toBe(true);
  });
});

describe("searchConversations", () => {
  it("returns results sorted by relevance", async () => {
    const results = await searchConversations("error", { projectsDir: fixturesDir });
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      const prevScore = results[i - 1]?.score ?? 0;
      const currScore = results[i]?.score ?? 0;
      expect(prevScore).toBeGreaterThanOrEqual(currScore);
    }
  });

  it("returns empty array for non-existent directory", async () => {
    const results = await searchConversations("test", { projectsDir: "/nonexistent" });
    expect(results).toEqual([]);
  });

  it("respects limit option", async () => {
    const results = await searchConversations("the", { projectsDir: fixturesDir, limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("filters by date range with after", async () => {
    const results = await searchConversations("test", {
      projectsDir: fixturesDir,
      after: new Date("2024-01-17T00:00:00.000Z"),
    });
    for (const result of results) {
      expect(result.conversation.startTime?.getTime()).toBeGreaterThanOrEqual(
        new Date("2024-01-17T00:00:00.000Z").getTime(),
      );
    }
  });

  it("filters by date range with before", async () => {
    const results = await searchConversations("help", {
      projectsDir: fixturesDir,
      before: new Date("2024-01-16T00:00:00.000Z"),
    });
    for (const result of results) {
      expect(result.conversation.endTime?.getTime()).toBeLessThanOrEqual(
        new Date("2024-01-16T00:00:00.000Z").getTime(),
      );
    }
  });

  it("filters by project path", async () => {
    const results = await searchConversations("authentication", {
      projectsDir: fixturesDir,
      project: "webapp",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.conversation.projectPath).toContain("webapp");
    }
  });

  it("finds matches in tool result content", async () => {
    const results = await searchConversations("OOMKilled", { projectsDir: fixturesDir });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.matchedContent.some((m) => m.startsWith("Result:"))).toBe(true);
  });

  it("filters by normalized project path", async () => {
    const results = await searchConversations("error", {
      projectsDir: fixturesDir,
      project: "/Users/test/project",
    });
    for (const result of results) {
      expect(result.conversation.projectPath).toBe("/Users/test/project");
    }
  });
});

describe("getDigest", () => {
  it("returns conversations sorted by start time descending", async () => {
    const result = await getDigest({ projectsDir: fixturesDir });
    expect(result.conversations.length).toBeGreaterThan(0);
    for (let i = 1; i < result.conversations.length; i++) {
      const prev = result.conversations[i - 1]?.startTime?.getTime() ?? 0;
      const curr = result.conversations[i]?.startTime?.getTime() ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("respects limit option", async () => {
    const result = await getDigest({ projectsDir: fixturesDir, limit: 2 });
    expect(result.conversations.length).toBeLessThanOrEqual(2);
  });

  it("filters by date range", async () => {
    const result = await getDigest({
      projectsDir: fixturesDir,
      after: new Date("2024-01-17T00:00:00.000Z"),
    });
    for (const conv of result.conversations) {
      expect(conv.startTime?.getTime()).toBeGreaterThanOrEqual(
        new Date("2024-01-17T00:00:00.000Z").getTime(),
      );
    }
  });

  it("reports truncation when results exceed limit", async () => {
    const result = await getDigest({ projectsDir: fixturesDir, limit: 1 });
    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBeGreaterThan(1);
  });

  it("excludes empty sessions by default", async () => {
    const result = await getDigest({ projectsDir: fixturesDir });
    for (const conv of result.conversations) {
      expect(conv.messages.length).toBeGreaterThan(0);
    }
  });
});

describe("formatDigest", () => {
  it("returns message for empty conversations", () => {
    const output = formatDigest({ conversations: [], totalCount: 0, truncated: false });
    expect(output).toBe("No conversations found.");
  });

  it("includes date, time, project, and summary", async () => {
    const result = await getDigest({ projectsDir: fixturesDir, limit: 1 });
    const output = formatDigest(result);
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}/);
    expect(output).toMatch(/\/Users\/test\//);
  });

  it("shows branch when available", async () => {
    const result = await getDigest({ projectsDir: fixturesDir });
    const output = formatDigest(result);
    expect(output).toMatch(/Branch:/);
  });

  it("shows truncation warning when results limited", async () => {
    const result = await getDigest({ projectsDir: fixturesDir, limit: 1 });
    const output = formatDigest(result);
    expect(output).toMatch(/Warning: Showing 1 of \d+ sessions/);
  });
});

describe("getStats", () => {
  it("aggregates tool usage across sessions", async () => {
    const stats = await getStats({ projectsDir: fixturesDir });
    expect(stats.totalSessions).toBeGreaterThan(0);
    expect(stats.tools.length).toBeGreaterThan(0);
    for (const tool of stats.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.uses).toBeGreaterThan(0);
    }
  });

  it("sorts tools by usage descending", async () => {
    const stats = await getStats({ projectsDir: fixturesDir });
    for (let i = 1; i < stats.tools.length; i++) {
      const prev = stats.tools[i - 1]?.uses ?? 0;
      const curr = stats.tools[i]?.uses ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

describe("formatStats", () => {
  it("returns message for empty stats", () => {
    const emptyStats = {
      tools: [],
      totalSessions: 0,
      totalToolUses: 0,
      totalErrors: 0,
    };
    const output = formatStats(emptyStats);
    expect(output).toBe("No sessions found.");
  });

  it("includes tool table and totals", async () => {
    const stats = await getStats({ projectsDir: fixturesDir });
    const output = formatStats(stats);
    expect(output).toMatch(/Tool/);
    expect(output).toMatch(/Uses/);
    expect(output).toMatch(/Errors/);
    expect(output).toMatch(/sessions/);
  });
});

describe("formatSearchResults", () => {
  it("returns message for empty results", () => {
    const output = formatSearchResults([]);
    expect(output).toBe("No matching conversations found.");
  });

  it("includes score in output", async () => {
    const results = await searchConversations("error", { projectsDir: fixturesDir });
    const output = formatSearchResults(results);
    expect(output).toMatch(/score: \d+\.\d+/);
  });

  it("includes matched content previews", async () => {
    const results = await searchConversations("error", { projectsDir: fixturesDir });
    const output = formatSearchResults(results);
    expect(output).toMatch(/-\s+\w+:/);
  });
});

describe("parseDate", () => {
  it('parses "today" as start of current day', () => {
    const date = parseDate("today");
    const now = new Date();
    expect(date.getFullYear()).toBe(now.getFullYear());
    expect(date.getMonth()).toBe(now.getMonth());
    expect(date.getDate()).toBe(now.getDate());
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('parses "yesterday" as start of previous day', () => {
    const date = parseDate("yesterday");
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expect(date.getFullYear()).toBe(expected.getFullYear());
    expect(date.getMonth()).toBe(expected.getMonth());
    expect(date.getDate()).toBe(expected.getDate());
  });

  it('parses "last week" as 7 days ago', () => {
    const date = parseDate("last week");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(date.getFullYear()).toBe(expected.getFullYear());
    expect(date.getMonth()).toBe(expected.getMonth());
    expect(date.getDate()).toBe(expected.getDate());
  });

  it("parses ISO date strings", () => {
    const date = parseDate("2024-01-15T12:00:00Z");
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(15);
  });

  it("throws on invalid date strings", () => {
    expect(() => parseDate("not-a-date")).toThrow("Unable to parse date");
  });

  it("is case insensitive for keywords", () => {
    const today = parseDate("TODAY");
    const yesterday = parseDate("Yesterday");
    expect(today.getHours()).toBe(0);
    expect(yesterday.getHours()).toBe(0);
  });
});

describe("mtime-based file filtering", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-test-"));
    const projectDir = path.join(tempDir, "-Users-test-project");
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("skips files with mtime before --after date", async () => {
    const projectDir = path.join(tempDir, "-Users-test-project");

    const oldFile = path.join(projectDir, "old-session.jsonl");
    const newFile = path.join(projectDir, "new-session.jsonl");

    const sessionContent = JSON.stringify({
      type: "user",
      message: { role: "user", content: "test" },
      sessionId: "test",
      cwd: "/test",
      timestamp: "2024-01-15T10:00:00.000Z",
    });

    await fs.writeFile(oldFile, sessionContent);
    await fs.writeFile(newFile, sessionContent);

    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    const newDate = new Date("2024-06-01T00:00:00.000Z");

    await fs.utimes(oldFile, oldDate, oldDate);
    await fs.utimes(newFile, newDate, newDate);

    const afterDate = new Date("2024-03-01T00:00:00.000Z");
    const files: string[] = [];
    for await (const file of streamSessionFiles({ projectsDir: tempDir, after: afterDate })) {
      files.push(path.basename(file.path));
    }

    expect(files).toContain("new-session.jsonl");
    expect(files).not.toContain("old-session.jsonl");
  });

  it("skips files with mtime after --before date", async () => {
    const projectDir = path.join(tempDir, "-Users-test-project");

    const oldFile = path.join(projectDir, "old-session.jsonl");
    const newFile = path.join(projectDir, "new-session.jsonl");

    const sessionContent = JSON.stringify({
      type: "user",
      message: { role: "user", content: "test" },
      sessionId: "test",
      cwd: "/test",
      timestamp: "2024-01-15T10:00:00.000Z",
    });

    await fs.writeFile(oldFile, sessionContent);
    await fs.writeFile(newFile, sessionContent);

    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    const newDate = new Date("2024-06-01T00:00:00.000Z");

    await fs.utimes(oldFile, oldDate, oldDate);
    await fs.utimes(newFile, newDate, newDate);

    const beforeDate = new Date("2024-03-01T00:00:00.000Z");
    const files: string[] = [];
    for await (const file of streamSessionFiles({ projectsDir: tempDir, before: beforeDate })) {
      files.push(path.basename(file.path));
    }

    expect(files).toContain("old-session.jsonl");
    expect(files).not.toContain("new-session.jsonl");
  });
});

describe("bounded concurrency", () => {
  it("processes items without exceeding concurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const concurrencyLimit = 3;

    async function* generateItems() {
      for (let i = 0; i < 10; i++) {
        yield i;
      }
    }

    const results: number[] = [];
    for await (const result of mapConcurrent(
      generateItems(),
      async (item) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return item * 2;
      },
      { concurrency: concurrencyLimit },
    )) {
      results.push(result);
    }

    expect(maxConcurrent).toBeLessThanOrEqual(concurrencyLimit);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it("handles large numbers of files without resource exhaustion", async () => {
    const itemCount = 100;

    async function* generateItems() {
      for (let i = 0; i < itemCount; i++) {
        yield i;
      }
    }

    const results: number[] = [];
    for await (const result of mapConcurrent(
      generateItems(),
      async (item) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return item;
      },
      { concurrency: 20 },
    )) {
      results.push(result);
    }

    expect(results).toHaveLength(itemCount);
    expect(results).toEqual([...Array(itemCount).keys()]);
  });

  it("preserves order of results", async () => {
    async function* generateItems() {
      for (let i = 0; i < 20; i++) {
        yield i;
      }
    }

    const results: number[] = [];
    for await (const result of mapConcurrent(
      generateItems(),
      async (item) => {
        const delay = Math.random() * 20;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return item;
      },
      { concurrency: 5 },
    )) {
      results.push(result);
    }

    expect(results).toEqual([...Array(20).keys()]);
  });
});
