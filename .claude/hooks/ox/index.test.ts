import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from "bun:test";
import { exec } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
  StopHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  invokesGitCommit,
  parseTranscript,
  processInput,
  processPostToolUse,
  processPreToolUse,
  processStop,
  runOxlintAgent,
} from ".";

const execAsync = promisify(exec);

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

// hookSpecificOutput is a union across every hook event, so narrow it to the
// PreToolUse arm before reading the permission fields.
function deniedBy(result: SyncHookJSONOutput | null): PreToolUseHookSpecificOutput | undefined {
  return result?.hookSpecificOutput as PreToolUseHookSpecificOutput | undefined;
}

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

function mockStopHookInput(
  transcriptPath: string,
  stopHookActive = false,
  sessionId = "test-session",
): StopHookInput {
  return {
    session_id: sessionId,
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

// A git repo whose ox config excludes ignored.ts. Checking that file must not
// read as a lint or format failure. The git init matters: runOxlintAgent
// resolves its cwd from the file's git toplevel, which is where oxlint
// discovers this config.
async function createIgnoredFixture(baseDir: string): Promise<string> {
  const repoDir = await mkdtemp(join(baseDir, "ignored-repo-"));
  await execAsync("git init", { cwd: repoDir });
  await Bun.write(
    join(repoDir, ".oxlintrc.json"),
    JSON.stringify({ ignorePatterns: ["ignored.ts"] }),
  );
  await Bun.write(
    join(repoDir, ".oxfmtrc.json"),
    JSON.stringify({ ignorePatterns: ["ignored.ts"] }),
  );
  const filePath = join(repoDir, "ignored.ts");
  const content = await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text();
  await Bun.write(filePath, content);
  return filePath;
}

describe("ox hook", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ox-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("runOxlintAgent", () => {
    test.each<{ name: string; fixture: string; expected: string | null }>([
      { name: "returns null for valid files", fixture: "valid.ts", expected: null },
      { name: "does not flag formatting-only issues", fixture: "fixable.ts", expected: null },
      { name: "returns errors for lint issues", fixture: "unfixable.ts", expected: "no-dupe-keys" },
    ])("$name", async ({ fixture, expected }) => {
      const filePath = await copyFixture(fixture, tempDir);
      const result = await runOxlintAgent(filePath);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result).toContain(expected);
      }
    });

    it("returns null for files the ox config ignores", async () => {
      const filePath = await createIgnoredFixture(tempDir);
      expect(await runOxlintAgent(filePath)).toBeNull();
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

    it("ignores non-ox files", async () => {
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

    it("filters out gitignored files but keeps tracked siblings", async () => {
      const repoDir = await mkdtemp(join(tempDir, "ignored-transcript-"));
      await execAsync("git init", { cwd: repoDir });
      await Bun.write(join(repoDir, ".gitignore"), "tmp/\n");
      const tracked = join(repoDir, "kept.ts");
      const ignored = join(repoDir, "tmp", "scratch.ts");
      await Bun.write(tracked, "export const a = 1;\n");
      await Bun.write(ignored, "export const b = 2;\n");

      const transcriptPath = join(tempDir, `transcript-gitignored-${Date.now()}.jsonl`);
      await Bun.write(
        transcriptPath,
        createTranscriptContent([
          { path: tracked, tool: "Write" },
          { path: ignored, tool: "Write" },
        ]),
      );

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([tracked]);
    });

    it("does not shell-evaluate a path containing a command substitution", async () => {
      const repoDir = await mkdtemp(join(tempDir, "injection-repo-"));
      await execAsync("git init", { cwd: repoDir });
      // isIgnored runs git with cwd = the file's directory, so a bare relative
      // name is where the injected `touch` would land if a shell evaluated it.
      const malicious = join(repoDir, "$(touch pwned).ts");
      await Bun.write(malicious, "export const a = 1;\n");

      const transcriptPath = join(tempDir, `transcript-injection-${Date.now()}.jsonl`);
      await Bun.write(
        transcriptPath,
        createTranscriptContent([{ path: malicious, tool: "Write" }]),
      );

      const files = await parseTranscript(transcriptPath);
      expect(files).toEqual([malicious]);
      expect(await Bun.file(join(repoDir, "pwned")).exists()).toBe(false);
    });
  });

  describe("processPostToolUse", () => {
    it("returns null for non-Edit/Write tools", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const input = mockPostToolUseInput("Read", { file_path: filePath });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns null for non-ox file extensions", async () => {
      const input = mockPostToolUseInput("Write", { file_path: "test.md" });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns null when oxlint passes", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const input = mockPostToolUseInput("Edit", { file_path: filePath });
      expect(await processPostToolUse(input)).toBeNull();
    });

    it("returns null for a formatting-only deviation, since PostToolUse never writes", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const before = await Bun.file(filePath).text();
      const input = mockPostToolUseInput("Write", { file_path: filePath });

      expect(await processPostToolUse(input)).toBeNull();
      expect(await Bun.file(filePath).text()).toBe(before);
    });

    it("returns additionalContext for lint issues without touching the file", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const before = await Bun.file(filePath).text();
      const input = mockPostToolUseInput("Edit", { file_path: filePath });
      const result = await processPostToolUse(input);

      expect(result).not.toBeNull();
      expect(result?.hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse" });

      const additionalContext = (result?.hookSpecificOutput as { additionalContext: string })
        .additionalContext;
      expect(additionalContext).toContain("no-dupe-keys");
      expect(await Bun.file(filePath).text()).toBe(before);
    });
  });

  describe("processStop", () => {
    // A blocked Stop wakes the model to repair, and the Stop that follows
    // carries stop_hook_active. Skipping the gate there ends the session on a
    // repair nothing checked.
    it("checks the re-entrant stop rather than skipping it", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-active-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath, true, `reentrant-${Date.now()}`);
      const result = await processStop(input);

      expect(result?.decision).toBe("block");
      expect(result?.reason).toContain("no-dupe-keys");
    });

    // An error the model cannot clear would otherwise block every Stop forever.
    it("gives way once the issues survive the block limit", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-limit-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));
      const session = `limit-${Date.now()}`;

      const first = await processStop(mockStopHookInput(transcriptPath, false, session));
      const second = await processStop(mockStopHookInput(transcriptPath, true, session));
      const third = await processStop(mockStopHookInput(transcriptPath, true, session));

      expect(first?.decision).toBe("block");
      expect(second?.decision).toBe("block");
      expect(third?.decision).toBeUndefined();
      expect(third?.systemMessage).toContain("no-dupe-keys");
    });

    // The budget is per round. A Stop the model did not reach through a block
    // ends the previous round, so the next one starts with its full count.
    it("restarts the count on a stop that did not follow a block", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-restart-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));
      const session = `restart-${Date.now()}`;

      await processStop(mockStopHookInput(transcriptPath, false, session));
      await processStop(mockStopHookInput(transcriptPath, true, session));
      const fresh = await processStop(mockStopHookInput(transcriptPath, false, session));

      expect(fresh?.decision).toBe("block");
    });

    it("returns null when no files were modified", async () => {
      const transcriptPath = join(tempDir, `transcript-empty-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, "");

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("returns null when all files pass", async () => {
      const filePath = await copyFixture("valid.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-valid-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("auto-formats fixable deviations and allows stop", async () => {
      const filePath = await copyFixture("fixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-fixable-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).toBeNull();
      expect(await Bun.file(filePath).text()).toContain("return a + b;");
    });

    it("returns block decision when issues cannot be auto-fixed", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-unfixable-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const input = mockStopHookInput(transcriptPath);
      const result = await processStop(input);

      expect(result).not.toBeNull();
      expect(result?.decision).toBe("block");
      expect(result?.reason).toContain("Ox check failed");
      expect(result?.reason).toContain("no-dupe-keys");
    });

    it("returns null when the only modified file is ignored by ox config", async () => {
      const filePath = await createIgnoredFixture(tempDir);
      const transcriptPath = join(tempDir, `transcript-ignored-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Edit" }]));

      const input = mockStopHookInput(transcriptPath);
      expect(await processStop(input)).toBeNull();
    });

    it("processes multiple files together", async () => {
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
    let repoDir: string;
    let outerCwd: string;

    beforeEach(async () => {
      outerCwd = process.cwd();
      repoDir = await mkdtemp(join(tempDir, "staged-"));
      await execAsync("git init -q", { cwd: repoDir });
      // Correctness rules are warnings by default, and the gate only sees a
      // non-zero exit. This mirrors the repo's own .oxlintrc.json.
      await Bun.write(
        join(repoDir, ".oxlintrc.json"),
        JSON.stringify({ categories: { correctness: "error" } }),
      );
      process.chdir(repoDir);
    });

    afterEach(() => {
      process.chdir(outerCwd);
    });

    async function stage(name: string, content: string): Promise<string> {
      const path = join(repoDir, name);
      await Bun.write(path, content);
      await execAsync(`git add ${name}`, { cwd: repoDir });
      return path;
    }

    it("returns null when no staged files", async () => {
      expect(await processPreToolUse(mockPreToolUseInput("git commit -m 'test'"))).toBeNull();
    });

    it("returns null when the staged files are clean", async () => {
      await stage("clean.ts", "export const a = 1;\n");
      expect(await processPreToolUse(mockPreToolUseInput("git commit -m x"))).toBeNull();
    });

    it("denies a commit whose staged files carry lint errors", async () => {
      await stage("bad.ts", await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text());

      const denial = deniedBy(await processPreToolUse(mockPreToolUseInput("git commit -m x")));
      expect(denial?.permissionDecision).toBe("deny");
      expect(denial?.permissionDecisionReason).toContain("no-dupe-keys");
      // This repo has no node_modules, so the type pass has nothing to resolve
      // imports against and drops out rather than blocking the commit.
      expect(denial?.permissionDecisionReason).toContain(
        "Types: skipped, dependencies are not installed here",
      );
    });

    // The gate reads working-tree files, so a staged blob the working copy has
    // moved on from would be committed unchecked.
    it("denies a commit whose staged file has further unstaged edits", async () => {
      const path = await stage("drift.ts", "export const a = 1;\n");
      await Bun.write(path, "export const a = 2;\n");

      const denial = deniedBy(await processPreToolUse(mockPreToolUseInput("git commit -m x")));
      expect(denial?.permissionDecision).toBe("deny");
      expect(denial?.permissionDecisionReason).toContain("drift.ts");
      expect(denial?.permissionDecisionReason).toContain("Stage or stash");
    });

    // Reformatting on disk without restaging would leave the index holding the
    // unformatted text the commit is about to record.
    it("restages the formatting it applied", async () => {
      await stage("messy.ts", "export const a = {  b:1 };\n");

      expect(await processPreToolUse(mockPreToolUseInput("git commit -m x"))).toBeNull();

      const { stdout } = await execAsync("git diff --name-only", { cwd: repoDir });
      expect(stdout.trim()).toBe("");
    });

    // The Bash matcher fails open on shell metacharacters, so these reach the
    // hook and must not be able to deny.
    test.each<[string]>([
      ["echo hi > $TMPDIR/probe.txt"],
      ["{ echo one; echo two; }"],
      ["for f in *.ts; do wc -l $f; done"],
      ["cat <<'EOF' > notes.md\nnothing here\nEOF"],
    ])("returns null for %p", async (command) => {
      expect(await processPreToolUse(mockPreToolUseInput(command))).toBeNull();
    });
  });

  // Stop and the commit gate share one pipeline, so these cover what differs:
  // the closing verb, and the fact that both batch file paths into a command.
  describe("runOxGate", () => {
    it("names the blocked action in the reason", async () => {
      const filePath = await copyFixture("unfixable.ts", tempDir);
      const transcriptPath = join(tempDir, `transcript-verb-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const result = await processStop(mockStopHookInput(transcriptPath));
      expect(result?.reason).toContain("Fix these issues before stopping.");
    });

    it("does not shell-evaluate a batched path containing a command substitution", async () => {
      const filePath = join(tempDir, "$(touch pwned)", "unfixable.ts");
      await Bun.write(filePath, await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text());

      const transcriptPath = join(tempDir, `transcript-hostile-${Date.now()}.jsonl`);
      await Bun.write(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Write" }]));

      const result = await processStop(mockStopHookInput(transcriptPath));

      expect(await Bun.file(join(tempDir, "pwned")).exists()).toBe(false);
      expect(result?.reason).toContain("no-dupe-keys");
    });
  });

  describe("invokesGitCommit", () => {
    test.each<[string, boolean]>([
      ["git commit", true],
      ["git -C /repo commit -m x", true],
      ["git -c user.name=x commit", true],
      ["git add . && git commit -m x", true],
      ["echo hi > $TMPDIR/probe.txt", false],
      ["git log --grep commit", false],
      ["echo 'run git commit next'", false],
    ])("%p → %p", (command, expected) => {
      expect(invokesGitCommit(command)).toBe(expected);
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
