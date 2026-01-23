import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-code";
import { hasTrailingNewline, processInput as checkInput } from "./check.ts";
import { ensureTrailingNewline, processInput as ensureInput } from "./ensure.ts";
import {
  preserveNewlineState,
  processInput as preserveInput,
} from "./preserve.ts";
import {
  getState,
  setState,
  clearState,
  clearAllState,
} from "./state.ts";

const testDir = join(tmpdir(), "newline-test");

function mockPreToolInput(filePath: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  };
}

function mockPostToolInput(filePath: string): PostToolUseHookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
    tool_result: "Success",
  };
}

function hasNewline(filePath: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return content.endsWith("\n");
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
  clearAllState();
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  clearAllState();
});

describe("state module", () => {
  it("stores and retrieves state", () => {
    setState("newline", "/test/file.txt", "1");
    expect(getState("newline", "/test/file.txt")).toBe("1");
  });

  it("returns empty string for missing state", () => {
    expect(getState("newline", "/nonexistent/file.txt")).toBe("");
  });

  it("clears state", () => {
    setState("newline", "/test/file.txt", "1");
    clearState("newline", "/test/file.txt");
    expect(getState("newline", "/test/file.txt")).toBe("");
  });
});

describe("check.ts", () => {
  describe("hasTrailingNewline", () => {
    it("returns null for empty file", () => {
      const filePath = join(testDir, "empty.txt");
      writeFileSync(filePath, "");
      expect(hasTrailingNewline(filePath)).toBeNull();
    });

    it("returns true for file with trailing newline", () => {
      const filePath = join(testDir, "with_newline.txt");
      writeFileSync(filePath, "content\n");
      expect(hasTrailingNewline(filePath)).toBe(true);
    });

    it("returns false for file without trailing newline", () => {
      const filePath = join(testDir, "no_newline.txt");
      writeFileSync(filePath, "content");
      expect(hasTrailingNewline(filePath)).toBe(false);
    });

    it("returns null for nonexistent file", () => {
      expect(hasTrailingNewline("/nonexistent/file.txt")).toBeNull();
    });
  });

  describe("processInput", () => {
    it("stores empty state for empty file", () => {
      const filePath = join(testDir, "empty.txt");
      writeFileSync(filePath, "");
      checkInput(mockPreToolInput(filePath));
      expect(getState("newline", filePath)).toBe("");
    });

    it("stores '1' for file with trailing newline", () => {
      const filePath = join(testDir, "with_newline.txt");
      writeFileSync(filePath, "content\n");
      checkInput(mockPreToolInput(filePath));
      expect(getState("newline", filePath)).toBe("1");
    });

    it("stores empty string for file without trailing newline", () => {
      const filePath = join(testDir, "no_newline.txt");
      writeFileSync(filePath, "content");
      checkInput(mockPreToolInput(filePath));
      expect(getState("newline", filePath)).toBe("");
    });

  });
});

describe("ensure.ts", () => {
  describe("ensureTrailingNewline", () => {
    it("adds newline to file without one", () => {
      const filePath = join(testDir, "no_newline.txt");
      writeFileSync(filePath, "content");
      const message = ensureTrailingNewline(filePath);
      expect(message).toBe("Added trailing newline");
      expect(hasNewline(filePath)).toBe(true);
    });

    it("preserves existing newline", () => {
      const filePath = join(testDir, "with_newline.txt");
      writeFileSync(filePath, "content\n");
      const message = ensureTrailingNewline(filePath);
      expect(message).toBe("File already has trailing newline");
      expect(hasNewline(filePath)).toBe(true);
    });

    it("skips empty files", () => {
      const filePath = join(testDir, "empty.txt");
      writeFileSync(filePath, "");
      const message = ensureTrailingNewline(filePath);
      expect(message).toBe("File is empty, skipping");
    });

    it("returns null for nonexistent file", () => {
      expect(ensureTrailingNewline("/nonexistent/file.txt")).toBeNull();
    });
  });

  describe("processInput", () => {
    it("returns additionalContext when adding newline", () => {
      const filePath = join(testDir, "no_newline.txt");
      writeFileSync(filePath, "content");
      const output = ensureInput(mockPostToolInput(filePath));
      expect(output?.hookSpecificOutput?.additionalContext).toContain(
        "Added trailing newline"
      );
    });
  });
});

describe("preserve.ts", () => {
  describe("preserveNewlineState", () => {
    it("adds newline when original had one", () => {
      const filePath = join(testDir, "preserve_with.txt");
      writeFileSync(filePath, "new content");
      const message = preserveNewlineState(filePath, "1");
      expect(message).toContain("Added trailing newline");
      expect(hasNewline(filePath)).toBe(true);
    });

    it("removes newline when original had none", () => {
      const filePath = join(testDir, "preserve_without.txt");
      writeFileSync(filePath, "new content\n");
      const message = preserveNewlineState(filePath, "");
      expect(message).toContain("Removed trailing newline");
      expect(hasNewline(filePath)).toBe(false);
    });

    it("preserves existing newline when original had one", () => {
      const filePath = join(testDir, "preserve_keep.txt");
      writeFileSync(filePath, "content\n");
      const message = preserveNewlineState(filePath, "1");
      expect(message).toBeNull();
      expect(hasNewline(filePath)).toBe(true);
    });

    it("skips empty files", () => {
      const filePath = join(testDir, "empty_preserve.txt");
      writeFileSync(filePath, "");
      const message = preserveNewlineState(filePath, "1");
      expect(message).toBe("File is empty, skipping");
    });
  });

  describe("processInput", () => {
    it("cleans up state after processing", () => {
      const filePath = join(testDir, "cleanup.txt");
      writeFileSync(filePath, "content\n");
      setState("newline", filePath, "1");
      preserveInput(mockPostToolInput(filePath));
      expect(getState("newline", filePath)).toBe("");
    });

  });
});

describe("integration", () => {
  it("preserves trailing newline through check and preserve cycle", () => {
    const filePath = join(testDir, "integration.txt");
    writeFileSync(filePath, "original content\n");

    checkInput(mockPreToolInput(filePath));
    expect(getState("newline", filePath)).toBe("1");

    writeFileSync(filePath, "modified content");

    preserveInput(mockPostToolInput(filePath));
    expect(hasNewline(filePath)).toBe(true);
    expect(getState("newline", filePath)).toBe("");
  });

  it("preserves no trailing newline through check and preserve cycle", () => {
    const filePath = join(testDir, "integration_no_newline.txt");
    writeFileSync(filePath, "original content");

    checkInput(mockPreToolInput(filePath));
    expect(getState("newline", filePath)).toBe("");

    writeFileSync(filePath, "modified content\n");

    preserveInput(mockPostToolInput(filePath));
    expect(hasNewline(filePath)).toBe(false);
    expect(getState("newline", filePath)).toBe("");
  });
});
