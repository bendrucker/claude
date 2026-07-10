import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { exec } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  parseTranscript,
  processInput,
  processPostToolUse,
  processPreToolUse,
  processStop,
  runBiomeCheck,
  runBiomeFix,
} from ".";

const execAsync = promisify(exec);

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
  const content = await Bun.file(source).text();
  await Bun.write(dest, content);
  return dest;
}

// A git repo whose Biome config excludes ignored.ts. Checking that file makes
// Biome report "no files were processed", which must not read as a lint
// failure. The git init matters: runBiomeCheck resolves its cwd from the
// file's git toplevel, which is where Biome discovers this config.
async function createIgnoredFixture(baseDir: string): Promise<string> {
  const repoDir = await mkdtemp(join(baseDir, "ignored-repo-"));
  await execAsync("git init", { cwd: repoDir });
  await Bun.write(
    join(repoDir, "biome.json"),
    JSON.stringify({ files: { includes: ["**", "!**/ignored.ts"] } }),
  );
  const filePath = join(repoDir, "ignored.ts");
  const content = await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text();
  await Bun.write(filePath, content);
  return filePath;
}

describe("biome hook", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "biome-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("runBiomeCheck", () => {
    test.each<{ name: string; fixture: string; expected: string | null }>([
      { name: "returns null for valid files", fixture: "valid.ts", expected: null },
      {
        name: "returns errors for files with fixable issues",
        fixture: "fixable.ts",
        expected: "format",
      },
      {
        name: "returns errors for files with unfixable issues",
        fixture: "unfixable.ts",
        expected: "noDuplicateObjectKeys",
      },
    ])("$name", async ({ fixture, expected }) => {
      const filePath = await copyFixture(fixture, tempDir);
      const result = await runBiomeCheck(filePath);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result).toContain(expected);
      }
    });

    it("returns null for files the Biome config ignores", async () => {
      const filePath = await createIgnoredFixture(tempDir);
      expect(await runBiomeCheck(filePath)).toBeNull();
    });
  });

  describe("runBiomeFix", () => {
    test.each<{ name: string; fixture: string; fixedAfter: boolean }>([
      { name: "fixes auto-fixable issues", fixture: "fixable.ts", fixedAfter: true },
      { name: "does not fix unsafe issues", fixture: "unfixable.ts", fixedAfter: false },
    ])("$name", async ({ fixture, fixedAfter }) => {
      const filePath = await copyFixture(fixture, tempDir);
      expect(await runBiomeCheck(filePath)).not.toBeNull();
      await runBiomeFix(filePath);
      const result = await runBiomeCheck(filePath);
      if (fixedAfter) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
      }
    });
  });

  describe("parseTranscript", () => {
    it("returns empty array for non-existent transcript", async () => {
      expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual([]);
    });

    test.each(["Edit", "Write"])("extracts file paths from %s tool uses", async (tool) => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-${tool}-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toContain(filePath);
    });

    it("ignores non-Biome files", async () => {
      const mdPath = join(tempDir, "readme.md");
      await Bun.write(mdPath, "# Test");
      const transcriptPath = join(tempDir, `transcript-md-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: mdPath, tool: "Write" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });

    it("ignores generated workflow scripts", async () => {
      const wfDir = join(tempDir, "workflows", "scripts");
      const wfPath = join(wfDir, "sweep-wf_123.js");
      await Bun.write(wfPath, "export const meta = {};\nreturn { done: true };\n");
      const transcriptPath = join(tempDir, `transcript-wf-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: wfPath, tool: "Edit" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });

    it("ignores non-Edit/Write tools", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-read-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([]);
    });

    it("deduplicates file paths", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-dup-${Date.now()}.jsonl`);
      await Bun.write(
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
      await Bun.write(
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

    test.each<{ name: string; fixture: string; tool: string; expected: string }>([
      {
        name: "returns additionalContext for fixable issues",
        fixture: "fixable.ts",
        tool: "Write",
        expected: "Biome found issues",
      },
      {
        name: "returns additionalContext for unfixable issues",
        fixture: "unfixable.ts",
        tool: "Edit",
        expected: "noDuplicateObjectKeys",
      },
    ])("$name", async ({ fixture, tool, expected }) => {
      const filePath = await copyFixture(fixture, tempDir);
      const input = mockPostToolUseInput(tool, { file_path: filePath });
      const result = await processPostToolUse(input);

      expect(result).not.toBeNull();
      expect(result?.hookSpecificOutput).toMatchObject({
        hookEventName: "PostToolUse",
      });

      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain(expected);
    });
  });

  describe("processStop", () => {
    it("returns null when stop_hook_active is true", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-active-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath, true);
      expect(await processStop(input)).toBeNull();
    });

    it("returns null when no files were modified", async () => {
      const transcriptPath = join(tempDir, `transcript-empty-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, "");

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("returns null when all files pass biome check", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-valid-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("auto-fixes fixable issues and allows stop", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-fixable-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).toBeNull();
      expect(await runBiomeCheck(filePath)).toBeNull();
    });

    it("returns block decision when issues cannot be auto-fixed", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-unfixable-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("block");
      expect(result?.reason).toContain("Biome check failed");
      expect(result?.reason).toContain("noDuplicateObjectKeys");
    });

    it("returns null when the only modified file is ignored by Biome config", async () => {
      const filePath = await createIgnoredFixture(tempDir);
      const transcriptPath = join(tempDir, `transcript-ignored-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("processes multiple files in parallel", async () => {
      const [validPath, fixablePath, unfixablePath] = await Promise.all([
        copyFixture("valid.ts", tempDir),
        copyFixture("fixable.ts", tempDir),
        copyFixture("unfixable.ts", tempDir),
      ]);

      const transcriptPath = join(tempDir, `transcript-multi-${Date.now()}.jsonl`);
      await Bun.write(
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
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

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
