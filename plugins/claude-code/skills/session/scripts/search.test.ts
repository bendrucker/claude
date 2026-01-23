import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseConversationFile,
  calculateRelevanceScore,
  searchConversations,
  getDigest,
  formatDigest,
  formatSearchResults,
  parseDate,
} from "./search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures", "sessions");
const projectDir = path.join(fixturesDir, "-Users-test-project");

describe("parseConversationFile", () => {
  it("parses basic JSONL session", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.sessionId).toBe("basic-session");
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]?.role).toBe("user");
    expect(conv.messages[1]?.role).toBe("assistant");
  });

  it("extracts project metadata", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.projectPath).toBe("/Users/test/project");
    expect(conv.gitBranch).toBe("main");
  });

  it("extracts timestamps", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.startTime).toEqual(new Date("2024-01-15T10:00:00.000Z"));
    expect(conv.endTime).toEqual(new Date("2024-01-15T10:01:00.000Z"));
  });

  it("extracts tool uses from assistant messages", () => {
    const conv = parseConversationFile(path.join(projectDir, "tools.jsonl"));
    const toolUses = conv.messages.flatMap((m) => m.toolUses);
    expect(toolUses).toHaveLength(3);
    expect(toolUses.some((t) => t.name === "Bash")).toBe(true);
    expect(toolUses.some((t) => t.name === "Read")).toBe(true);
    expect(toolUses.some((t) => t.name === "Edit")).toBe(true);
  });

  it("extracts summary when present", () => {
    const conv = parseConversationFile(path.join(projectDir, "summary.jsonl"));
    expect(conv.summary).toBe(
      "Fixed database connection pooling issue causing timeouts under load",
    );
  });

  it("handles sessions without summary", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
    expect(conv.summary).toBeNull();
  });

  it("skips malformed JSON lines and parses valid ones", () => {
    const conv = parseConversationFile(path.join(projectDir, "malformed.jsonl"));
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]?.content).toContain("Valid message");
  });

  it("returns null projectPath when not present", () => {
    const conv = parseConversationFile(path.join(projectDir, "malformed.jsonl"));
    expect(conv.projectPath).toBe("/Users/test/malformed");
  });
});

describe("calculateRelevanceScore", () => {
  it("returns zero for empty query", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
    const { score } = calculateRelevanceScore("", conv);
    expect(score).toBe(0);
  });

  it("weights summaries 3x higher", () => {
    const convWithSummary = parseConversationFile(path.join(projectDir, "summary.jsonl"));
    const convWithoutSummary = parseConversationFile(path.join(projectDir, "basic.jsonl"));

    const summaryScore = calculateRelevanceScore("database", convWithSummary);
    const noSummaryScore = calculateRelevanceScore("database", convWithoutSummary);

    expect(summaryScore.score).toBeGreaterThan(noSummaryScore.score);
  });

  it("boosts user messages over assistant messages", () => {
    const conv = parseConversationFile(path.join(projectDir, "multiple.jsonl"));
    // "refactor" appears in user message
    const { score } = calculateRelevanceScore("refactor", conv);
    expect(score).toBeGreaterThan(0);
  });

  it("includes tool uses in scoring", () => {
    const conv = parseConversationFile(path.join(projectDir, "tools.jsonl"));
    const { score, matchedContent } = calculateRelevanceScore("Bash npm", conv);
    expect(score).toBeGreaterThan(0);
    expect(matchedContent.some((m) => m.includes("Tool:"))).toBe(true);
  });

  it("returns matched content previews", () => {
    const conv = parseConversationFile(path.join(projectDir, "basic.jsonl"));
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
    const conversations = await getDigest({ projectsDir: fixturesDir });
    expect(conversations.length).toBeGreaterThan(0);
    for (let i = 1; i < conversations.length; i++) {
      const prev = conversations[i - 1]?.startTime?.getTime() ?? 0;
      const curr = conversations[i]?.startTime?.getTime() ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("respects limit option", async () => {
    const conversations = await getDigest({ projectsDir: fixturesDir, limit: 2 });
    expect(conversations.length).toBeLessThanOrEqual(2);
  });

  it("filters by date range", async () => {
    const conversations = await getDigest({
      projectsDir: fixturesDir,
      after: new Date("2024-01-17T00:00:00.000Z"),
    });
    for (const conv of conversations) {
      expect(conv.startTime?.getTime()).toBeGreaterThanOrEqual(
        new Date("2024-01-17T00:00:00.000Z").getTime(),
      );
    }
  });
});

describe("formatDigest", () => {
  it("returns message for empty conversations", () => {
    const output = formatDigest([]);
    expect(output).toBe("No conversations found.");
  });

  it("includes date, time, project, and summary", async () => {
    const conversations = await getDigest({ projectsDir: fixturesDir, limit: 1 });
    const output = formatDigest(conversations);
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}/);
    expect(output).toMatch(/\/Users\/test\//);
  });

  it("shows branch when available", async () => {
    const conversations = await getDigest({ projectsDir: fixturesDir });
    const output = formatDigest(conversations);
    expect(output).toMatch(/Branch:/);
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
