import * as fs from "node:fs";
import * as path from "node:path";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatOutput, isCleanupAgentActive, processInput } from "../hooks/detect";

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
