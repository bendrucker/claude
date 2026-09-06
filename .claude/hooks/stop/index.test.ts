import { afterAll, afterEach, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { parseTranscript, processStop, scopePaths } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "stop-hook-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function stopInput(overrides?: Partial<StopHookInput>): StopHookInput {
  return {
    hook_event_name: "Stop",
    session_id: "test",
    transcript_path: "/dev/null",
    cwd: tempDir,
    stop_hook_active: false,
    permission_mode: "default",
    ...overrides,
  };
}

function createTranscriptContent(files: { path: string; tool: string }[]): string {
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

describe("parseTranscript", () => {
  it("returns empty array for non-existent transcript", async () => {
    expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual([]);
  });

  it("extracts file paths from Edit and Write tool uses", async () => {
    const filePath = join(tempDir, "test.ts");
    const mdPath = join(tempDir, "readme.md");
    await Bun.write(filePath, "export {}");
    await Bun.write(mdPath, "# Test");

    const transcriptPath = join(tempDir, "transcript-tools.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([
        { path: filePath, tool: "Edit" },
        { path: mdPath, tool: "Write" },
      ]),
    );

    const files = await parseTranscript(transcriptPath);
    expect(files).toContain(filePath);
    expect(files).toContain(mdPath);
  });

  it("ignores non-Edit/Write tools", async () => {
    const filePath = join(tempDir, "read-only.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-read.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });

  it("deduplicates file paths", async () => {
    const filePath = join(tempDir, "dup.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-dup.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([
        { path: filePath, tool: "Edit" },
        { path: filePath, tool: "Write" },
      ]),
    );

    expect(await parseTranscript(transcriptPath)).toHaveLength(1);
  });

  it("filters out deleted files", async () => {
    const transcriptPath = join(tempDir, "transcript-deleted.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([{ path: "/nonexistent/deleted.ts", tool: "Write" }]),
    );

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });
});

describe("scopePaths", () => {
  test.each<[string[], string[], string[]]>([
    [["repo"], ["repo", "plugins", "mac", "plugin.json"], [join("plugins", "mac", "plugin.json")]],
    [["repo"], ["other-worktree", "plugins", "mac", "plugin.json"], []],
    [["a", "b", "c"], ["a", "elsewhere.ts"], []],
    [["repo"], ["repo", "..foo.ts"], ["..foo.ts"]],
  ])("cwd=%p file=%p -> %p", (cwdParts, fileParts, expected) => {
    const cwd = join(tempDir, ...cwdParts);
    const file = join(tempDir, ...fileParts);
    expect(scopePaths([file], cwd)).toEqual(expected);
  });
});

describe("processStop", () => {
  const originalRemoteEnv = process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE;

  afterEach(() => {
    if (originalRemoteEnv === undefined) {
      delete process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE;
    } else {
      process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE = originalRemoteEnv;
    }
  });

  it("skips prek when running in a remote environment", async () => {
    const filePath = join(tempDir, "remote-skip.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-remote.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

    process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE = "cloud_default";

    expect(await processStop(stopInput({ transcript_path: transcriptPath }))).toBeNull();
  });

  it("returns null when every collected file is out-of-tree", async () => {
    const sibling = join(tempDir, "sibling-worktree");
    const filePath = join(sibling, "plugins", "mac", "plugin.json");
    await Bun.write(filePath, "{}");

    const cwd = join(tempDir, "main-worktree");
    await Bun.write(join(cwd, ".keep"), "");

    const transcriptPath = join(tempDir, "transcript-out-of-tree.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

    expect(await processStop(stopInput({ transcript_path: transcriptPath, cwd }))).toBeNull();
  });
});
