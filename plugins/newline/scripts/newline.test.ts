import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { processInput as checkInput, hasTrailingNewline } from "./check";
import { processInput as ensureInput, ensureTrailingNewline } from "./ensure";
import { processInput as preserveInput, preserveNewlineState } from "./preserve";
import { clearAllState, clearState, getState, setState } from "./state";

const testDir = join(tmpdir(), "newline-test");

function mockPreToolInput(filePath: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd: "/tmp",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
    tool_use_id: "test",
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
    tool_response: "Success",
    tool_use_id: "test",
  };
}

async function hasNewline(filePath: string): Promise<boolean> {
  const content = await Bun.file(filePath).text();
  return content.endsWith("\n");
}

beforeEach(async () => {
  mkdirSync(testDir, { recursive: true });
  await clearAllState();
});

afterEach(async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {}
  await clearAllState();
});

describe("state module", () => {
  it("stores and retrieves state", async () => {
    await setState("newline", "/test/file.txt", "1");
    expect(await getState("newline", "/test/file.txt")).toBe("1");
  });

  it("returns empty string for missing state", async () => {
    expect(await getState("newline", "/nonexistent/file.txt")).toBe("");
  });

  it("clears state", async () => {
    await setState("newline", "/test/file.txt", "1");
    await clearState("newline", "/test/file.txt");
    expect(await getState("newline", "/test/file.txt")).toBe("");
  });
});

describe("check.ts", () => {
  describe("hasTrailingNewline", () => {
    it("returns null for empty file", async () => {
      const filePath = join(testDir, "empty.txt");
      await Bun.write(filePath, "");
      expect(await hasTrailingNewline(filePath)).toBeNull();
    });

    it("returns true for file with trailing newline", async () => {
      const filePath = join(testDir, "with_newline.txt");
      await Bun.write(filePath, "content\n");
      expect(await hasTrailingNewline(filePath)).toBe(true);
    });

    it("returns false for file without trailing newline", async () => {
      const filePath = join(testDir, "no_newline.txt");
      await Bun.write(filePath, "content");
      expect(await hasTrailingNewline(filePath)).toBe(false);
    });

    it("returns null for nonexistent file", async () => {
      expect(await hasTrailingNewline("/nonexistent/file.txt")).toBeNull();
    });
  });

  describe("processInput", () => {
    it("stores empty state for empty file", async () => {
      const filePath = join(testDir, "empty.txt");
      await Bun.write(filePath, "");
      await checkInput(mockPreToolInput(filePath));
      expect(await getState("newline", filePath)).toBe("");
    });

    it("stores '1' for file with trailing newline", async () => {
      const filePath = join(testDir, "with_newline.txt");
      await Bun.write(filePath, "content\n");
      await checkInput(mockPreToolInput(filePath));
      expect(await getState("newline", filePath)).toBe("1");
    });

    it("stores empty string for file without trailing newline", async () => {
      const filePath = join(testDir, "no_newline.txt");
      await Bun.write(filePath, "content");
      await checkInput(mockPreToolInput(filePath));
      expect(await getState("newline", filePath)).toBe("");
    });
  });
});

describe("ensure.ts", () => {
  describe("ensureTrailingNewline", () => {
    it("adds newline to file without one", async () => {
      const filePath = join(testDir, "no_newline.txt");
      await Bun.write(filePath, "content");
      const message = await ensureTrailingNewline(filePath);
      expect(message).toBe("Added trailing newline");
      expect(await hasNewline(filePath)).toBe(true);
    });

    it("preserves existing newline", async () => {
      const filePath = join(testDir, "with_newline.txt");
      await Bun.write(filePath, "content\n");
      const message = await ensureTrailingNewline(filePath);
      expect(message).toBe("File already has trailing newline");
      expect(await hasNewline(filePath)).toBe(true);
    });

    it("skips empty files", async () => {
      const filePath = join(testDir, "empty.txt");
      await Bun.write(filePath, "");
      const message = await ensureTrailingNewline(filePath);
      expect(message).toBe("File is empty, skipping");
    });

    it("returns null for nonexistent file", async () => {
      expect(await ensureTrailingNewline("/nonexistent/file.txt")).toBeNull();
    });
  });

  describe("processInput", () => {
    it("returns additionalContext when adding newline", async () => {
      const filePath = join(testDir, "no_newline.txt");
      await Bun.write(filePath, "content");
      const output = await ensureInput(mockPostToolInput(filePath));
      const hookOutput = output?.hookSpecificOutput as PostToolUseHookSpecificOutput | undefined;
      expect(hookOutput?.additionalContext).toContain("Added trailing newline");
    });
  });
});

describe("preserve.ts", () => {
  describe("preserveNewlineState", () => {
    it("adds newline when original had one", async () => {
      const filePath = join(testDir, "preserve_with.txt");
      await Bun.write(filePath, "new content");
      const message = await preserveNewlineState(filePath, "1");
      expect(message).toContain("Added trailing newline");
      expect(await hasNewline(filePath)).toBe(true);
    });

    it("removes newline when original had none", async () => {
      const filePath = join(testDir, "preserve_without.txt");
      await Bun.write(filePath, "new content\n");
      const message = await preserveNewlineState(filePath, "");
      expect(message).toContain("Removed trailing newline");
      expect(await hasNewline(filePath)).toBe(false);
    });

    it("preserves existing newline when original had one", async () => {
      const filePath = join(testDir, "preserve_keep.txt");
      await Bun.write(filePath, "content\n");
      const message = await preserveNewlineState(filePath, "1");
      expect(message).toBeNull();
      expect(await hasNewline(filePath)).toBe(true);
    });

    it("skips empty files", async () => {
      const filePath = join(testDir, "empty_preserve.txt");
      await Bun.write(filePath, "");
      const message = await preserveNewlineState(filePath, "1");
      expect(message).toBe("File is empty, skipping");
    });
  });

  describe("processInput", () => {
    it("cleans up state after processing", async () => {
      const filePath = join(testDir, "cleanup.txt");
      await Bun.write(filePath, "content\n");
      await setState("newline", filePath, "1");
      await preserveInput(mockPostToolInput(filePath));
      expect(await getState("newline", filePath)).toBe("");
    });
  });
});

describe("integration", () => {
  it("preserves trailing newline through check and preserve cycle", async () => {
    const filePath = join(testDir, "integration.txt");
    await Bun.write(filePath, "original content\n");

    await checkInput(mockPreToolInput(filePath));
    expect(await getState("newline", filePath)).toBe("1");

    await Bun.write(filePath, "modified content");

    await preserveInput(mockPostToolInput(filePath));
    expect(await hasNewline(filePath)).toBe(true);
    expect(await getState("newline", filePath)).toBe("");
  });

  it("preserves no trailing newline through check and preserve cycle", async () => {
    const filePath = join(testDir, "integration_no_newline.txt");
    await Bun.write(filePath, "original content");

    await checkInput(mockPreToolInput(filePath));
    expect(await getState("newline", filePath)).toBe("");

    await Bun.write(filePath, "modified content\n");

    await preserveInput(mockPostToolInput(filePath));
    expect(await hasNewline(filePath)).toBe(false);
    expect(await getState("newline", filePath)).toBe("");
  });
});

describe("memory files", () => {
  const memoryPath = `${process.env.HOME}/.claude/projects/-Users-ben-test/memory/MEMORY.md`;

  it("check skips memory files without touching state", async () => {
    await checkInput(mockPreToolInput(memoryPath));
    expect(await getState("newline", memoryPath)).toBe("");
  });

  it("ensure skips memory files", async () => {
    const output = await ensureInput(mockPostToolInput(memoryPath));
    expect(output).toBeNull();
  });

  it("preserve skips memory files", async () => {
    const output = await preserveInput(mockPostToolInput(memoryPath));
    expect(output).toBeNull();
  });

  it("ensure still processes non-memory files", async () => {
    const filePath = join(testDir, "non_memory.txt");
    await Bun.write(filePath, "no newline");
    const output = await ensureInput(mockPostToolInput(filePath));
    expect(output).not.toBeNull();
    expect(await hasNewline(filePath)).toBe(true);
  });
});
