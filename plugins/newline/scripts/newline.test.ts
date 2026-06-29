import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PostToolUseHookInput,
  PostToolUseHookSpecificOutput,
  PreToolUseHookInput,
} from "@bendrucker/claude-plugin-toolkit";
import fc from "fast-check";
import { processInput as checkInput, hasTrailingNewline } from "./check";
import { processInput as ensureInput, ensureTrailingNewline } from "./ensure";
import { processInput as preserveInput, preserveNewlineState } from "./preserve";
import { clearAllState, clearState, getState, setState } from "./state";

// Isolate fixtures and state per test process so concurrent suites (prek runs many
// at once) don't collide on shared /tmp paths.
const testRoot = mkdtempSync(join(tmpdir(), "newline-test-"));
const testDir = join(testRoot, "fixtures");
process.env.CLAUDE_NEWLINE_STATE_FILE = join(testRoot, "state.json");

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
    test.each<{ name: string; write: boolean; content: string; expected: boolean | null }>([
      { name: "empty file", write: true, content: "", expected: null },
      { name: "file with trailing newline", write: true, content: "content\n", expected: true },
      { name: "file without trailing newline", write: true, content: "content", expected: false },
      { name: "nonexistent file", write: false, content: "", expected: null },
    ])("returns $expected for $name", async ({ write, content, expected }) => {
      const filePath = join(testDir, "file.txt");
      if (write) await Bun.write(filePath, content);
      const target = write ? filePath : "/nonexistent/file.txt";
      expect(await hasTrailingNewline(target)).toBe(expected);
    });
  });

  describe("processInput", () => {
    test.each<{ name: string; content: string; expected: string }>([
      { name: "empty file", content: "", expected: "" },
      { name: "file with trailing newline", content: "content\n", expected: "1" },
      { name: "file without trailing newline", content: "content", expected: "" },
    ])("stores '$expected' for $name", async ({ content, expected }) => {
      const filePath = join(testDir, "file.txt");
      await Bun.write(filePath, content);
      await checkInput(mockPreToolInput(filePath));
      expect(await getState("newline", filePath)).toBe(expected);
    });
  });
});

describe("ensure.ts", () => {
  describe("ensureTrailingNewline", () => {
    test.each<{
      name: string;
      write: boolean;
      content: string;
      message: string | null;
      newline: boolean | null;
    }>([
      {
        name: "no newline",
        write: true,
        content: "content",
        message: "Added trailing newline",
        newline: true,
      },
      { name: "existing newline", write: true, content: "content\n", message: null, newline: true },
      { name: "empty file", write: true, content: "", message: null, newline: null },
      { name: "nonexistent file", write: false, content: "", message: null, newline: null },
    ])("$name", async ({ write, content, message, newline }) => {
      const filePath = join(testDir, "file.txt");
      if (write) await Bun.write(filePath, content);
      const target = write ? filePath : "/nonexistent/file.txt";
      expect(await ensureTrailingNewline(target)).toBe(message);
      if (newline !== null) {
        expect(await hasNewline(target)).toBe(newline);
      }
    });
  });

  describe("processInput", () => {
    test.each<{ name: string; content: string; expectAdded: boolean }>([
      { name: "no newline", content: "content", expectAdded: true },
      { name: "existing newline", content: "content\n", expectAdded: false },
      { name: "empty file", content: "", expectAdded: false },
    ])("$name", async ({ content, expectAdded }) => {
      const filePath = join(testDir, "file.txt");
      await Bun.write(filePath, content);
      const output = await ensureInput(mockPostToolInput(filePath));
      if (expectAdded) {
        const hookOutput = output?.hookSpecificOutput as PostToolUseHookSpecificOutput | undefined;
        expect(hookOutput?.additionalContext).toContain("Added trailing newline");
      } else {
        expect(output).toBeNull();
      }
    });
  });
});

describe("preserve.ts", () => {
  describe("preserveNewlineState", () => {
    test.each<{
      name: string;
      content: string;
      state: string;
      message: string | null;
      contains: boolean;
      newline: boolean | null;
    }>([
      {
        name: "adds newline when original had one",
        content: "new content",
        state: "1",
        message: "Added trailing newline",
        contains: true,
        newline: true,
      },
      {
        name: "removes newline when original had none",
        content: "new content\n",
        state: "",
        message: "Removed trailing newline",
        contains: true,
        newline: false,
      },
      {
        name: "preserves existing newline when original had one",
        content: "content\n",
        state: "1",
        message: null,
        contains: false,
        newline: true,
      },
      {
        name: "skips empty files",
        content: "",
        state: "1",
        message: "File is empty, skipping",
        contains: false,
        newline: null,
      },
    ])("$name", async ({ content, state, message, contains, newline }) => {
      const filePath = join(testDir, "file.txt");
      await Bun.write(filePath, content);
      const result = await preserveNewlineState(filePath, state);
      if (contains) {
        expect(result).toContain(message as string);
      } else {
        expect(result).toBe(message);
      }
      if (newline !== null) {
        expect(await hasNewline(filePath)).toBe(newline);
      }
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

type FileContent = { body: string; newline: boolean };

const fileContent = fc.record<FileContent>({
  body: fc.string({ minLength: 1 }),
  newline: fc.boolean(),
});

function render({ body, newline }: FileContent): string {
  return newline ? `${body}\n` : body;
}

describe("integration", () => {
  it("restores the original trailing-newline state through the check/preserve cycle", async () => {
    const filePath = join(testDir, "prop.txt");
    await fc.assert(
      fc.asyncProperty(fileContent, fileContent, async (original, edited) => {
        const originalContent = render(original);
        await Bun.write(filePath, originalContent);
        const originalHadNewline = originalContent.endsWith("\n");

        await checkInput(mockPreToolInput(filePath));

        await Bun.write(filePath, render(edited));

        await preserveInput(mockPostToolInput(filePath));

        expect(await hasNewline(filePath)).toBe(originalHadNewline);
        expect(await getState("newline", filePath)).toBe("");
      }),
    );
  });

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
