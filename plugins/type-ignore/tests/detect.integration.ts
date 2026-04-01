import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
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
  beforeEach(async () => {
    if (await Bun.file(MARKER_DIR).exists()) {
      rmSync(MARKER_DIR, { recursive: true });
    }
  });

  afterEach(async () => {
    if (await Bun.file(MARKER_DIR).exists()) {
      rmSync(MARKER_DIR, { recursive: true });
    }
  });

  describe("isCleanupAgentActive", () => {
    it("returns false when no marker exists", async () => {
      expect(await isCleanupAgentActive()).toBe(false);
    });

    it("returns true when recent marker exists", async () => {
      const sessionId = process.env.CLAUDE_SESSION_ID || "unknown";
      const markerPath = path.join(MARKER_DIR, sessionId);

      mkdirSync(MARKER_DIR, { recursive: true });
      await Bun.write(markerPath, String(Date.now()));

      expect(await isCleanupAgentActive()).toBe(true);
    });
  });

  describe("processInput", () => {
    it("detects TypeScript ignore in Edit", async () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "const x = bad();",
        new_string: "// @ts-ignore\nconst x = bad();",
      });

      const result = await processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("@ts-ignore");
      expect(additionalContext).toContain("type-ignore:fixer");
    });

    it("detects TypeScript ignore in Write", async () => {
      const input = mockPostToolUseInput("Write", {
        file_path: "/path/to/file.ts",
        content: "// @ts-expect-error\nconst x = bad();",
      });

      const result = await processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("@ts-expect-error");
    });

    it("detects Python ignore in Edit", async () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.py",
        old_string: "result = func()",
        new_string: "result = func()  # type: ignore",
      });

      const result = await processInput(input);
      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("type: ignore");
    });

    it("ignores non-target file extensions", async () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.md",
        old_string: "content",
        new_string: "// @ts-ignore",
      });

      const result = await processInput(input);
      expect(result).toBeNull();
    });

    it("suppresses when cleanup agent is active", async () => {
      const sessionId = process.env.CLAUDE_SESSION_ID || "unknown";
      const markerPath = path.join(MARKER_DIR, sessionId);

      mkdirSync(MARKER_DIR, { recursive: true });
      await Bun.write(markerPath, String(Date.now()));

      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "const x = bad();",
        new_string: "// @ts-ignore\nconst x = bad();",
      });

      const result = await processInput(input);
      expect(result).toBeNull();
    });

    it("returns null when no new ignore added", async () => {
      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "// @ts-ignore\nconst x = bad();",
        new_string: "// @ts-ignore\nconst x = stillBad();",
      });

      const result = await processInput(input);
      expect(result).toBeNull();
    });

    it("ignores non-Edit/Write tools", async () => {
      const input = mockPostToolUseInput("Bash", { command: "echo test" });

      const result = await processInput(input);
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
