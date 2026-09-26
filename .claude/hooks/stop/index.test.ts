import { afterAll, afterEach, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { parseTranscript, processStop, scopePaths, statePath } from ".";

let tempDir: string;
let sessionCounter = 0;
const stopSessions = new Set<string>();

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "stop-hook-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
  await Promise.all(
    [...stopSessions].map((session) => rm(statePath(session), { recursive: true, force: true })),
  );
});

// Each test gets its own session id, since the recorded position is keyed by
// session and would otherwise leak between tests sharing one.
function uniqueSession(): string {
  sessionCounter += 1;
  const session = `stop-hook-test-${sessionCounter}`;
  stopSessions.add(session);
  return session;
}

function stopInput(overrides?: Partial<StopHookInput>): StopHookInput {
  return {
    hook_event_name: "Stop",
    session_id: uniqueSession(),
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
  it("returns empty files for non-existent transcript", async () => {
    expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual({ files: [], lineCount: 0 });
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

    const { files } = await parseTranscript(transcriptPath);
    expect(files).toContain(filePath);
    expect(files).toContain(mdPath);
  });

  it("extracts file paths from MultiEdit tool uses", async () => {
    const filePath = join(tempDir, "multi-edit.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-multi-edit.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([{ path: filePath, tool: "MultiEdit" }]),
    );

    expect((await parseTranscript(transcriptPath)).files).toContain(filePath);
  });

  it("ignores non-Edit/Write tools", async () => {
    const filePath = join(tempDir, "read-only.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-read.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

    expect((await parseTranscript(transcriptPath)).files).toEqual([]);
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

    expect((await parseTranscript(transcriptPath)).files).toHaveLength(1);
  });

  it("filters out deleted files", async () => {
    const transcriptPath = join(tempDir, "transcript-deleted.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([{ path: "/nonexistent/deleted.ts", tool: "Write" }]),
    );

    expect((await parseTranscript(transcriptPath)).files).toEqual([]);
  });

  it("only scans lines at or after the given offset", async () => {
    const firstPath = join(tempDir, "since-first.ts");
    const secondPath = join(tempDir, "since-second.ts");
    await Bun.write(firstPath, "export {}");
    await Bun.write(secondPath, "export {}");

    const transcriptPath = join(tempDir, "transcript-since.jsonl");
    await Bun.write(
      transcriptPath,
      createTranscriptContent([
        { path: firstPath, tool: "Edit" },
        { path: secondPath, tool: "Edit" },
      ]),
    );

    const full = await parseTranscript(transcriptPath);
    expect(full.files).toEqual([firstPath, secondPath]);
    expect(full.lineCount).toBe(2);

    const since = await parseTranscript(transcriptPath, 1);
    expect(since.files).toEqual([secondPath]);
    expect(since.lineCount).toBe(2);
  });

  it("reports the transcript's actual length when the offset runs past it", async () => {
    const filePath = join(tempDir, "past-end.ts");
    await Bun.write(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-past-end.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

    expect(await parseTranscript(transcriptPath, 5)).toEqual({ files: [], lineCount: 1 });
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

  // The hook spawns `bun` and `prek` by name, so a stub earlier on PATH records
  // the calls without running either for real.
  async function withStubbedCommands<T>(
    exitCodes: Record<string, number>,
    run: (bin: string, readCalls: () => Promise<string[]>) => Promise<T>,
  ): Promise<T> {
    const stubDir = await mkdtemp(join(tmpdir(), "stop-hook-stub-"));
    const bin = join(stubDir, "bin");
    const log = join(stubDir, "calls.log");
    await Promise.all(
      ["bun", "prek"].map(async (name) => {
        const stub = join(bin, name);
        await Bun.write(
          stub,
          `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${exitCodes[name] ?? 0}\n`,
        );
        Bun.spawnSync(["chmod", "+x", stub]);
      }),
    );

    const readCalls = async (): Promise<string[]> => {
      const file = Bun.file(log);
      const text = (await file.exists()) ? await file.text() : "";
      return text.split("\n").filter((line) => line !== "");
    };

    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    try {
      return await run(bin, readCalls);
    } finally {
      process.env.PATH = originalPath;
      await rm(stubDir, { recursive: true, force: true });
    }
  }

  test.each<{
    name: string;
    manifest: boolean;
    exitCodes?: Record<string, number>;
    expected: (cwd: string) => string[];
  }>([
    {
      name: "installs before prek when the stop directory is a JS project",
      manifest: true,
      expected: (cwd) => [`bun install --cwd ${cwd}`, "prek run --files touched.ts"],
    },
    {
      name: "runs prek anyway when the install fails",
      manifest: true,
      exitCodes: { bun: 1 },
      expected: (cwd) => [`bun install --cwd ${cwd}`, "prek run --files touched.ts"],
    },
    {
      name: "runs prek without installing when the stop directory has no manifest",
      manifest: false,
      expected: () => ["prek run --files touched.ts"],
    },
  ])("$name", async ({ manifest, exitCodes, expected }) => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    if (manifest) {
      await Bun.write(join(cwd, "package.json"), "{}");
    }

    await withStubbedCommands(exitCodes ?? {}, async (_bin, readCalls) => {
      const filePath = join(cwd, "touched.ts");
      await Bun.write(filePath, "export {}");
      const transcriptPath = join(cwd, "transcript.jsonl");
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      expect(await processStop(stopInput({ transcript_path: transcriptPath, cwd }))).toBeNull();
      expect(await readCalls()).toEqual(expected(cwd));
    });

    await rm(cwd, { recursive: true, force: true });
  });

  it("skips install when node_modules is newer than the manifest", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    await Bun.write(join(cwd, "package.json"), "{}");
    await mkdir(join(cwd, "node_modules"));

    await withStubbedCommands({}, async (_bin, readCalls) => {
      const filePath = join(cwd, "touched.ts");
      await Bun.write(filePath, "export {}");
      const transcriptPath = join(cwd, "transcript.jsonl");
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      expect(await processStop(stopInput({ transcript_path: transcriptPath, cwd }))).toBeNull();
      expect(await readCalls()).toEqual(["prek run --files touched.ts"]);
    });

    await rm(cwd, { recursive: true, force: true });
  });

  it("reinstalls when the manifest changes after node_modules exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    await mkdir(join(cwd, "node_modules"));
    // node_modules must predate the manifest write below for this to exercise
    // the "manifest changed" branch rather than the "no node_modules" one.
    await Bun.sleep(10);
    await Bun.write(join(cwd, "package.json"), "{}");

    await withStubbedCommands({}, async (_bin, readCalls) => {
      const filePath = join(cwd, "touched.ts");
      await Bun.write(filePath, "export {}");
      const transcriptPath = join(cwd, "transcript.jsonl");
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      expect(await processStop(stopInput({ transcript_path: transcriptPath, cwd }))).toBeNull();
      expect(await readCalls()).toEqual([
        `bun install --cwd ${cwd}`,
        "prek run --files touched.ts",
      ]);
    });

    await rm(cwd, { recursive: true, force: true });
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

  it("skips prek on a Stop with no edits since the previous non-blocking Stop", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    const filePath = join(cwd, "touched.ts");
    await Bun.write(filePath, "export {}");
    const transcriptPath = join(cwd, "transcript.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));
    const session = stopInput({ transcript_path: transcriptPath, cwd });

    await withStubbedCommands({}, async (_bin, readCalls) => {
      expect(await processStop(session)).toBeNull();
      expect(await readCalls()).toEqual(["prek run --files touched.ts"]);

      // Same transcript, same session: nothing new to check.
      expect(await processStop(session)).toBeNull();
      expect(await readCalls()).toEqual(["prek run --files touched.ts"]);
    });

    await rm(cwd, { recursive: true, force: true });
  });

  it("scopes prek to only the files edited since the last processed Stop", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    const firstPath = join(cwd, "first.ts");
    const secondPath = join(cwd, "second.ts");
    await Bun.write(firstPath, "export {}");
    await Bun.write(secondPath, "export {}");
    const transcriptPath = join(cwd, "transcript.jsonl");
    const session = stopInput({ transcript_path: transcriptPath, cwd });

    await withStubbedCommands({}, async (_bin, readCalls) => {
      await Bun.write(transcriptPath, createTranscriptContent([{ path: firstPath, tool: "Edit" }]));
      expect(await processStop(session)).toBeNull();
      expect(await readCalls()).toEqual(["prek run --files first.ts"]);

      await Bun.write(
        transcriptPath,
        createTranscriptContent([
          { path: firstPath, tool: "Edit" },
          { path: secondPath, tool: "Edit" },
        ]),
      );
      expect(await processStop(session)).toBeNull();
      expect(await readCalls()).toEqual([
        "prek run --files first.ts",
        "prek run --files second.ts",
      ]);
    });

    await rm(cwd, { recursive: true, force: true });
  });

  it("does not advance the recorded position past a Stop that blocked", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stop-hook-cwd-"));
    const filePath = join(cwd, "touched.ts");
    await Bun.write(filePath, "export {}");
    const transcriptPath = join(cwd, "transcript.jsonl");
    await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));
    const session = stopInput({ transcript_path: transcriptPath, cwd });

    await withStubbedCommands({ prek: 1 }, async (_bin, readCalls) => {
      const first = await processStop(session);
      expect(first?.decision).toBe("block");

      // No new edits landed, but the first Stop never cleared the block, so the
      // same file is still checked rather than skipped as a no-op.
      const second = await processStop(session);
      expect(second?.decision).toBe("block");

      expect(await readCalls()).toEqual([
        "prek run --files touched.ts",
        "prek run --files touched.ts",
      ]);
    });

    await rm(cwd, { recursive: true, force: true });
  });
});
