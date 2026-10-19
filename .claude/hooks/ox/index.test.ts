import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout, test } from "bun:test";
import { exec } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PostToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  formatPostToolUseOutput,
  HookInput,
  POST_TOOL_USE_LINE_LIMIT,
  processPostToolUse,
  runOxlintAgent,
} from ".";

// Every check here spawns oxlint over a real fixture.
setDefaultTimeout(30_000);

const Reported = z.looseObject({ additionalContext: z.string().optional() });

// oxlint-disable-next-line typescript/strict-void-return -- tsc resolves promisify(exec) through Node's [util.promisify.custom] overload correctly; a cast narrow enough to satisfy this rule trips typescript/no-unsafe-type-assertion instead.
const execAsync = promisify(exec);

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function contextFrom(result: SyncHookJSONOutput | null): string | undefined {
  const output = result?.hookSpecificOutput;
  return output?.hookEventName === "PostToolUse" ? output.additionalContext : undefined;
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

async function copyFixture(name: string, destDir: string): Promise<string> {
  const source = join(FIXTURES_DIR, name);
  const dest = join(destDir, `${Date.now()}-${Math.random()}-${name}`);
  const content = await Bun.file(source).text();
  await Bun.write(dest, content);
  return dest;
}

// A git repo whose oxlint config excludes ignored.ts. Checking that file must
// not read as a lint failure. The git init matters: runOxlintAgent
// resolves its cwd from the file's git toplevel, which is where oxlint
// discovers this config.
async function createIgnoredFixture(baseDir: string): Promise<string> {
  const repoDir = await mkdtemp(join(baseDir, "ignored-repo-"));
  await execAsync("git init", { cwd: repoDir });
  await Bun.write(
    join(repoDir, ".oxlintrc.json"),
    JSON.stringify({ ignorePatterns: ["ignored.ts"] }),
  );
  const filePath = join(repoDir, "ignored.ts");
  const content = await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text();
  await Bun.write(filePath, content);
  return filePath;
}

// A repo whose default config flags the file and whose fast config does not.
// The per-file pass must read the fast config, so a passing result proves the
// default was skipped rather than that the file happens to be clean.
async function createFastConfigFixture(baseDir: string): Promise<string> {
  const repoDir = await mkdtemp(join(baseDir, "fast-config-repo-"));
  await execAsync("git init", { cwd: repoDir });
  await Bun.write(
    join(repoDir, ".oxlintrc.json"),
    JSON.stringify({ rules: { "no-dupe-keys": "error" } }),
  );
  await Bun.write(
    join(repoDir, ".oxlintrc.fast.json"),
    JSON.stringify({ rules: { "no-dupe-keys": "off" } }),
  );
  const filePath = join(repoDir, "duplicate.ts");
  await Bun.write(filePath, await Bun.file(join(FIXTURES_DIR, "unfixable.ts")).text());
  return filePath;
}

// The per-edit pass must stay type-unaware however the tree is installed, so
// `nodeModules` picks which of three shapes a fixture exercises. The empty tree
// stands in for a partial install: node_modules exists, the checker is not in it.
type NodeModules = "linked" | "empty" | "absent";

async function createTypeAwareFixture(
  baseDir: string,
  { nodeModules }: { nodeModules: NodeModules },
): Promise<string> {
  const repoDir = await mkdtemp(join(baseDir, "type-aware-repo-"));
  await execAsync("git init", { cwd: repoDir });
  await Bun.write(
    join(repoDir, ".oxlintrc.json"),
    JSON.stringify({
      plugins: ["typescript"],
      rules: { "typescript/no-misused-promises": "error", "no-dupe-keys": "error" },
    }),
  );
  if (nodeModules === "linked") {
    const repoRoot = join(import.meta.dirname, "..", "..", "..");
    await execAsync(`ln -s "${join(repoRoot, "node_modules")}" node_modules`, { cwd: repoDir });
  } else if (nodeModules === "empty") {
    await mkdir(join(repoDir, "node_modules"));
  }
  const filePath = join(repoDir, "schedule.ts");
  await Bun.write(filePath, await Bun.file(join(FIXTURES_DIR, "type-aware.ts")).text());
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

    it("prefers the fast config over the default one", async () => {
      const filePath = await createFastConfigFixture(tempDir);
      expect(await runOxlintAgent(filePath)).toBeNull();
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

      expect(contextFrom(result)).toContain("no-dupe-keys");
      expect(await Bun.file(filePath).text()).toBe(before);
    });

    async function typeAwareContext(nodeModules: NodeModules): Promise<string | undefined> {
      const filePath = await createTypeAwareFixture(tempDir, { nodeModules });
      const result = await processPostToolUse(
        mockPostToolUseInput("Edit", { file_path: filePath }),
      );
      return Reported.safeParse(result?.hookSpecificOutput).data?.additionalContext;
    }

    it.each<{ nodeModules: NodeModules }>([
      { nodeModules: "linked" },
      { nodeModules: "absent" },
      { nodeModules: "empty" },
    ])(
      "leaves type-aware rules to the gate with node_modules $nodeModules",
      async ({ nodeModules }) => {
        const context = await typeAwareContext(nodeModules);

        expect(context).toContain("no-dupe-keys");
        expect(context).not.toContain("no-misused-promises");
        expect(context).not.toContain("tsgolint");
      },
    );
  });

  describe("formatPostToolUseOutput", () => {
    function diagnostics(count: number): string {
      return Array.from({ length: count }, (_, line) => `a.ts:${line + 1}:1: error`).join("\n");
    }

    it("passes output within the limit through whole", () => {
      const errors = diagnostics(POST_TOOL_USE_LINE_LIMIT);
      expect(contextFrom(formatPostToolUseOutput("a.ts", errors))).toContain(errors);
    });

    it("caps output past the limit and points at the full check", () => {
      const context = contextFrom(
        formatPostToolUseOutput("a.ts", diagnostics(POST_TOOL_USE_LINE_LIMIT + 25)),
      );

      expect(context).toContain(`a.ts:${POST_TOOL_USE_LINE_LIMIT}:1: error`);
      expect(context).not.toContain(`a.ts:${POST_TOOL_USE_LINE_LIMIT + 1}:1: error`);
      expect(context).toContain("25 more lines omitted. Run `bun run check` for the rest.");
    });
  });

  test.each([
    { title: "an unrecognized event", value: { hook_event_name: "Unknown" } },
    { title: "a missing event name", value: {} },
    { title: "PostToolUse without a tool name", value: { hook_event_name: "PostToolUse" } },
    { title: "a non-object payload", value: "PostToolUse" },
  ])("the boundary rejects $title", ({ value }) => {
    expect(HookInput.safeParse(value).success).toBe(false);
  });
});
