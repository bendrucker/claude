import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseTranscript,
  processInput,
  processPostToolUse,
  processPreToolUse,
  processStop,
  runBiomeCheck,
  runBiomeFix,
} from ".";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

let tempDir: string;

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

function mockPreToolUseInput(command: string): PreToolUseHookInput {
  return {
    session_id: "test-session",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    transcript_path: "/tmp/transcript.json",
    cwd: process.cwd(),
    tool_use_id: "test",
  };
}

function mockStopHookInput(transcriptPath: string, stopHookActive = false): StopHookInput {
  return {
    session_id: "test-session",
    hook_event_name: "Stop",
    transcript_path: transcriptPath,
    cwd: process.cwd(),
    stop_hook_active: stopHookActive,
  };
}

function createTranscriptContent(files: Array<{ path: string; tool: string }>): string {
  return files
    .map((f) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: f.tool,
              input: { file_path: f.path },
            },
          ],
        },
      }),
    )
    .join("\n");
}

async function copyFixture(name: string, destDir: string): Promise<string> {
  const source = join(FIXTURES_DIR, name);
  const dest = join(destDir, `${Date.now()}-${Math.random()}-${name}`);
  const content = await readFile(source, "utf-8");
  await writeFile(dest, content);
  return dest;
}

describe("biome hook", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "biome-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("runBiomeCheck", () => {
    it("returns null for valid files", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      expect(await runBiomeCheck(filePath)).toBeNull();
    });

    it("returns errors for files with fixable issues", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const result = await runBiomeCheck(filePath);
      expect(result).not.toBeNull();
      expect(result).toContain("format");
    });

    it("returns errors for files with unfixable issues", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const result = await runBiomeCheck(filePath);
      expect(result).not.toBeNull();
      expect(result).toContain("noDuplicateObjectKeys");
    });
  });

  describe("runBiomeFix", () => {
    it("fixes auto-fixable issues", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      expect(await runBiomeCheck(filePath)).not.toBeNull();
      await runBiomeFix(filePath);
      expect(await runBiomeCheck(filePath)).toBeNull();
    });

    it("does not fix unsafe issues", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      expect(await runBiomeCheck(filePath)).not.toBeNull();
      await runBiomeFix(filePath);
      expect(await runBiomeCheck(filePath)).not.toBeNull();
    });
  });

  describe("parseTranscript", () => {
    it("returns empty array for non-existent transcript", async () => {
      expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual([]);
    });

    it("extracts file paths from Edit tool uses", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-edit-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toContain(filePath);
    });

    it("extracts file paths from Write tool uses", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-write-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toContain(filePath);
    });

    it("ignores non-Biome files", async () => {
      const mdPath = join(tempDir, "readme.md");
      await writeFile(mdPath, "# Test");
      const transcriptPath = join(tempDir, `transcript-md-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: mdPath, tool: "Write" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });

    it("ignores non-Edit/Write tools", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-read-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });

    it("deduplicates file paths", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-dup-${Date.now()}.jsonl`);
      await writeFile(
        transcriptPath,
        createTranscriptContent([
          { path: filePath, tool: "Edit" },
          { path: filePath, tool: "Edit" },
        ]),
      );

      const files = await parseTranscript(transcriptPath);
      expect(files).toHaveLength(1);
    });

    it("filters out deleted files", async () => {
      const transcriptPath = join(tempDir, `transcript-deleted-${Date.now()}.jsonl`);
      await writeFile(
        transcriptPath,
        createTranscriptContent([{ path: "/nonexistent/deleted.ts", tool: "Write" }]),
      );

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });
  });

  describe("processPostToolUse", () => {
    it("returns null for non-Edit/Write tools", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const input = mockPostToolUseInput("Read", { file_path: filePath });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns null for non-Biome file extensions", async () => {
      const input = mockPostToolUseInput("Write", { file_path: "test.md" });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns null when biome check passes", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const input = mockPostToolUseInput("Edit", { file_path: filePath });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns additionalContext for fixable issues", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const input = mockPostToolUseInput("Write", { file_path: filePath });
      const result = await processPostToolUse(input);

      expect(result).not.toBeNull();
      expect(result?.hookSpecificOutput).toMatchObject({
        hookEventName: "PostToolUse",
      });

      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("Biome found issues");
    });

    it("returns additionalContext for unfixable issues", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const input = mockPostToolUseInput("Edit", { file_path: filePath });
      const result = await processPostToolUse(input);

      expect(result).not.toBeNull();
      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("noDuplicateObjectKeys");
    });
  });

  describe("processStop", () => {
    it("returns null when stop_hook_active is true", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-active-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath, true);
      expect(await processStop(input)).toBeNull();
    });

    it("returns null when no files were modified", async () => {
      const transcriptPath = join(tempDir, `transcript-empty-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, "");

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("returns null when all files pass biome check", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-valid-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("auto-fixes fixable issues and allows stop", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-fixable-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).toBeNull();
      expect(await runBiomeCheck(filePath)).toBeNull();
    });

    it("returns block decision when issues cannot be auto-fixed", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-unfixable-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("block");
      expect(result?.reason).toContain("Biome found issues");
      expect(result?.reason).toContain("noDuplicateObjectKeys");
    });

    it("processes multiple files in parallel", async () => {
      const [validPath, fixablePath, unfixablePath] = await Promise.all([
        copyFixture("valid.ts", tempDir),
        copyFixture("fixable.ts", tempDir),
        copyFixture("unfixable.ts", tempDir),
      ]);

      const transcriptPath = join(tempDir, `transcript-multi-${Date.now()}.jsonl`);
      await writeFile(
        transcriptPath,
        createTranscriptContent([
          { path: validPath, tool: "Edit" },
          { path: fixablePath, tool: "Write" },
          { path: unfixablePath, tool: "Edit" },
        ]),
      );

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("block");
      expect(result?.reason).toContain(unfixablePath);
      expect(result?.reason).not.toContain(validPath);
      expect(result?.reason).not.toContain(fixablePath);
    });
  });

  describe("processPreToolUse", () => {
    // Note: Command filtering is handled by the hook matcher in settings.json
    // The hook itself just checks staged files when invoked

    it("returns null when no staged files", async () => {
      // In test environment, there are no staged git files
      const input = mockPreToolUseInput("git commit -m 'test'");
      expect(await processPreToolUse(input)).toBeNull();
    });
  });

  describe("processInput", () => {
    it("routes PostToolUse events correctly", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const input = mockPostToolUseInput("Write", { file_path: filePath });
      const result = await processInput(input);

      expect(result?.hookSpecificOutput).toBeDefined();
    });

    it("routes Stop events correctly", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-route-${Date.now()}.jsonl`);
      await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processInput(input);

      expect(result?.decision).toBe("block");
    });

    it("returns null for unknown event types", async () => {
      const input = { hook_event_name: "Unknown" } as unknown as PostToolUseHookInput;
      expect(await processInput(input)).toBeNull();
    });
  });
});
