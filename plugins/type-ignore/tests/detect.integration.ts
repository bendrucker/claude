import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
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
    await rm(MARKER_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(MARKER_DIR, { recursive: true, force: true });
  });

  describe("isCleanupAgentActive", () => {
    it("returns false when no marker exists", async () => {
      expect(await isCleanupAgentActive("test-session")).toBe(false);
    });

    it("returns true when recent marker exists", async () => {
      const sessionId = "test-session";
      const markerPath = join(MARKER_DIR, sessionId);

      mkdirSync(MARKER_DIR, { recursive: true });
      await Bun.write(markerPath, String(Date.now()));

      expect(await isCleanupAgentActive(sessionId)).toBe(true);
    });

    it("keeps markers independent across session ids", async () => {
      const markerPath = join(MARKER_DIR, "session-a");

      mkdirSync(MARKER_DIR, { recursive: true });
      await Bun.write(markerPath, String(Date.now()));

      expect(await isCleanupAgentActive("session-a")).toBe(true);
      expect(await isCleanupAgentActive("session-b")).toBe(false);
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
      const specific = result?.hookSpecificOutput;
      const additionalContext =
        specific?.hookEventName === "PostToolUse" ? (specific.additionalContext ?? "") : "";
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
      const specific = result?.hookSpecificOutput;
      const additionalContext =
        specific?.hookEventName === "PostToolUse" ? (specific.additionalContext ?? "") : "";
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
      const specific = result?.hookSpecificOutput;
      const additionalContext =
        specific?.hookEventName === "PostToolUse" ? (specific.additionalContext ?? "") : "";
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

    it("suppresses when cleanup agent is active for the same session", async () => {
      const markerPath = join(MARKER_DIR, "test-session");

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

    it("does not suppress when cleanup agent is active for a different session", async () => {
      const markerPath = join(MARKER_DIR, "other-session");

      mkdirSync(MARKER_DIR, { recursive: true });
      await Bun.write(markerPath, String(Date.now()));

      const input = mockPostToolUseInput("Edit", {
        file_path: "/path/to/file.ts",
        old_string: "const x = bad();",
        new_string: "// @ts-ignore\nconst x = bad();",
      });

      const result = await processInput(input);
      expect(result).not.toBeNull();
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

      const specific = result.hookSpecificOutput;
      expect(specific?.hookEventName).toBe("PostToolUse");
      const additionalContext =
        specific?.hookEventName === "PostToolUse" ? (specific.additionalContext ?? "") : "";
      expect(additionalContext).toContain("file.ts:42");
      expect(additionalContext).toContain("@ts-ignore");
      expect(additionalContext).toContain("type-ignore:fixer");
    });
  });
});
