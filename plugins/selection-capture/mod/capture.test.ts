import { describe, expect, test } from "claude-code/testing";
import {
  type Capture,
  launchUrl,
  linearUrl,
  mainRepo,
  quote,
  row,
  thingsUrl,
  title,
} from "./capture.ts";

const MESSAGES = [
  { role: "user", text: "why does the build fail?", toolUses: [] },
  {
    role: "assistant",
    text: "The lockfile floats.\n\nPin   the version   instead.",
    toolUses: [
      { tool_use_id: "toolu_1", tool: "Bash", input: { command: "bun install --frozen-lockfile" } },
    ],
  },
] as const;

const CAPTURE: Capture = {
  title: "Pin the version",
  quote: "> Pin the version",
  row: { label: "Claude", text: "Pin the version instead." },
  launch: "claude-cli://open?q=x&cwd=%2Frepo",
};

describe("quote", () => {
  test("prefixes every line, keeping blank ones in the quote", () => {
    expect(quote("one\n\ntwo\n")).toBe("> one\n>\n> two");
  });
});

describe("title", () => {
  test("prefers the command's argument", () => {
    expect(title("  Fix CI ", "anything")).toBe("Fix CI");
  });

  test("falls back to the selection's first line, clipped", () => {
    expect(title("", "first line\nsecond")).toBe("first line");
    expect(title("", "x".repeat(100))).toHaveLength(80);
  });
});

describe("row", () => {
  test("names a tool call by its tool_use_id", () => {
    expect(row({ text: "frozen", requestId: "toolu_1" }, MESSAGES)).toEqual({
      label: "Bash",
      text: "bun install --frozen-lockfile",
    });
  });

  test("finds the message holding the selection across rewrapped whitespace", () => {
    expect(row({ text: "Pin the\nversion" }, MESSAGES)).toEqual({
      label: "Claude",
      text: "The lockfile floats.\n\nPin   the version   instead.",
    });
  });

  test("is absent when no message holds the selection", () => {
    expect(row({ text: "elsewhere" }, MESSAGES)).toBeUndefined();
  });
});

describe("mainRepo", () => {
  test("strips .git from a worktree's common dir", () => {
    expect(mainRepo("/src/repo/.git\n", "/wt/topic")).toBe("/src/repo");
  });

  test("keeps the root for a bare repository", () => {
    expect(mainRepo("/src/repo.git", "/wt/topic")).toBe("/wt/topic");
  });
});

describe("urls", () => {
  test("launch URL encodes the prompt and cwd", () => {
    const url = launchUrl("s1", "> hi", "/src/repo");
    expect(url.startsWith("claude-cli://open?q=")).toBe(true);
    expect(url).toContain("cwd=%2Fsrc%2Frepo");
    expect(decodeURIComponent(url)).toContain("claude --resume s1");
    expect(decodeURIComponent(url)).toContain("> hi");
  });

  test("Things to-do carries the quote, row, and launch link in its notes", () => {
    const url = thingsUrl(CAPTURE);
    expect(url).toContain("things:///add?title=Pin%20the%20version&notes=");
    expect(url).toContain("&tags=claude");
    const notes = decodeURIComponent(url.split("notes=")[1]?.split("&")[0] ?? "");
    expect(notes).toBe(
      "> Pin the version\n\nFrom Claude:\n\n```\nPin the version instead.\n```\n\nContinue in Claude Code: claude-cli://open?q=x&cwd=%2Frepo",
    );
  });

  test("Linear draft prefills title and description", () => {
    expect(linearUrl(CAPTURE)).toMatch(
      /^https:\/\/linear\.new\?title=Pin%20the%20version&description=/,
    );
  });
});
