import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDate } from "./search/date";
import { formatDigest, formatSearchResults, formatStats } from "./search/format";
import { parseConversationFile } from "./search/parse";
import { getDigest, searchConversations } from "./search/query";
import { calculateRelevanceScore } from "./search/score";
import { getStats } from "./search/stats";

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

  it("identifies sessions with most errors", async () => {
    const stats = await getStats({ projectsDir: fixturesDir });
    for (const session of stats.sessionsWithMostErrors) {
      expect(session.errorCount).toBeGreaterThan(0);
      expect(session.filePath).toBeTruthy();
    }
  });
});

describe("formatStats", () => {
  it("returns message for empty stats", () => {
    const emptyStats = {
      tools: [],
      sessionsWithMostErrors: [],
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
