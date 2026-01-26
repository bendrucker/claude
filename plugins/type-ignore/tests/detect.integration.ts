import * as fs from "node:fs";
import * as path from "node:path";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findIgnorePattern,
  findLineNumber,
  formatOutput,
  hasNewIgnore,
  isCleanupAgentActive,
  processInput,
} from "../hooks/detect";

const MARKER_DIR = "/tmp/claude/type-ignore-active";

function mockPostToolUseInput(
  toolName: string,
  toolInput: Record<string, unknown>,
): PostToolUseHookInput {
  return {
    session_id: "test-session",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

describe("type-ignore detection hook", () => {
  beforeEach(() => {
    if (fs.existsSync(MARKER_DIR)) {
      fs.rmSync(MARKER_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(MARKER_DIR)) {
      fs.rmSync(MARKER_DIR, { recursive: true });
    }
  });

  describe("findIgnorePattern", () => {
    it("detects @ts-ignore in TypeScript", () => {
      const content = "// @ts-ignore\nconst x = bad();";
      expect(findIgnorePattern(content, "typescript")).toEqual({
        label: "@ts-ignore",
        match: "@ts-ignore",
      });
    });

    it("detects @ts-expect-error in TypeScript", () => {
      const content = "// @ts-expect-error\nconst x = bad();";
      expect(findIgnorePattern(content, "typescript")).toEqual({
        label: "@ts-expect-error",
        match: "@ts-expect-error",
      });
    });

    it("detects eslint-disable in TypeScript", () => {
      const content = "// eslint-disable-next-line\nconst x = 1;";
      expect(findIgnorePattern(content, "typescript")).toEqual({
        label: "eslint-disable",
        match: "eslint-disable-next-line",
      });
    });

    it("detects # type: ignore in Python", () => {
      const content = "x = bad()  # type: ignore";
      expect(findIgnorePattern(content, "python")).toEqual({
        label: "type: ignore",
        match: "# type: ignore",
      });
    });

    it("detects # noqa in Python", () => {
      const content = "import unused  # noqa";
      expect(findIgnorePattern(content, "python")).toEqual({
        label: "noqa",
        match: "# noqa",
      });
    });

    it("returns null for clean code", () => {
      expect(findIgnorePattern("const x = 1;", "typescript")).toBeNull();
      expect(findIgnorePattern("x = 1", "python")).toBeNull();
    });
  });

  describe("hasNewIgnore", () => {
    it("detects new ignore in TypeScript Edit", () => {
      const oldString = "const x = bad();";
      const newString = "// @ts-ignore\nconst x = bad();";
      expect(hasNewIgnore(oldString, newString, "typescript")).toEqual({
        label: "@ts-ignore",
        match: "@ts-ignore",
      });
    });

    it("returns null when ignore already existed", () => {
      const oldString = "// @ts-ignore\nconst x = bad();";
      const newString = "// @ts-ignore\nconst x = stillBad();";
      expect(hasNewIgnore(oldString, newString, "typescript")).toBeNull();
    });

    it("returns null when no ignore in new content", () => {
      const oldString = "const x = 1;";
      const newString = "const x = 2;";
      expect(hasNewIgnore(oldString, newString, "typescript")).toBeNull();
    });

    it("detects new Python ignore", () => {
      const oldString = "result = func()";
      const newString = "result = func()  # type: ignore";
      expect(hasNewIgnore(oldString, newString, "python")).toEqual({
        label: "type: ignore",
        match: "# type: ignore",
      });
    });
  });

  describe("findLineNumber", () => {
    it("finds line number of pattern", () => {
      const content = "line1\nline2\n// @ts-ignore\nline4";
      expect(findLineNumber(content, "@ts-ignore")).toBe(3);
    });

    it("returns 1 if pattern not found", () => {
      const content = "line1\nline2";
      expect(findLineNumber(content, "@ts-ignore")).toBe(1);
    });
  });

  describe("isCleanupAgentActive", () => {
    it("returns false when no marker exists", () => {
      expect(isCleanupAgentActive()).toBe(false);
    });

    it("returns true when recent marker exists", () => {
      const sessionId = process.env.CLAUDE_SESSION_ID || "unknown";
      const markerPath = path.join(MARKER_DIR, sessionId);

      fs.mkdirSync(MARKER_DIR, { recursive: true });
      fs.writeFileSync(markerPath, String(Date.now()));

      expect(isCleanupAgentActive()).toBe(true);
    });
  });

  describe("processInput", () => {
    it("detects TypeScript ignore in Edit", () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "const x = bad();",
        new_string: "// @ts-ignore\nconst x = bad();",
      });

      const result = processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("@ts-ignore");
      expect(additionalContext).toContain("type-ignore:fixer");
    });

    it("detects TypeScript ignore in Write", () => {
      const input = mockPostToolUseInput("Write", {
        file_path: "/path/to/file.ts",
        content: "// @ts-expect-error\nconst x = bad();",
      });

      const result = processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("@ts-expect-error");
    });

    it("detects Python ignore in Edit", () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.py",
        old_string: "result = func()",
        new_string: "result = func()  # type: ignore",
      });

      const result = processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("type: ignore");
    });

    it("ignores non-target file extensions", () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.md",
        old_string: "content",
        new_string: "// @ts-ignore",
      });

      const result = processInput(input);
      expect(result).toBeNull();
    });

    it("suppresses when cleanup agent is active", () => {
      const sessionId = process.env.CLAUDE_SESSION_ID || "unknown";
      const markerPath = path.join(MARKER_DIR, sessionId);

      fs.mkdirSync(MARKER_DIR, { recursive: true });
      fs.writeFileSync(markerPath, String(Date.now()));

      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "const x = bad();",
        new_string: "// @ts-ignore\nconst x = bad();",
      });

      const result = processInput(input);
      expect(result).toBeNull();
    });

    it("returns null when no new ignore added", () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "// @ts-ignore\nconst x = bad();",
        new_string: "// @ts-ignore\nconst x = stillBad();",
      });

      const result = processInput(input);
      expect(result).toBeNull();
    });

    it("ignores non-Edit/Write tools", () => {
      const input = mockPostToolUseInput("Bash", { command: "echo test" });

      const result = processInput(input);
      expect(result).toBeNull();
    });
  });

  describe("formatOutput", () => {
    it("formats output with file, line, and pattern", () => {
      const result = formatOutput("/path/to/file.ts", 42, "@ts-ignore");

      expect(result.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
      const additionalContext = (result.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("file.ts:42");
      expect(additionalContext).toContain("@ts-ignore");
      expect(additionalContext).toContain("type-ignore:fixer");
    });
  });
});
