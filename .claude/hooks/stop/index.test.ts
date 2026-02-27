import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { type Check, categorizeChecks, parseTranscript } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "stop-hook-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

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

function checkNames(checks: Check[]): string[] {
  return checks.map((c) => c.name);
}

describe("parseTranscript", () => {
  it("returns empty array for non-existent transcript", async () => {
    expect(await parseTranscript("/nonexistent/path.jsonl")).toEqual([]);
  });

  it("extracts file paths from Edit and Write tool uses", async () => {
    const filePath = join(tempDir, "test.ts");
    const mdPath = join(tempDir, "readme.md");
    await writeFile(filePath, "export {}");
    await writeFile(mdPath, "# Test");

    const transcriptPath = join(tempDir, "transcript-tools.jsonl");
    await writeFile(
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
    await writeFile(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-read.jsonl");
    await writeFile(transcriptPath, createTranscriptContent([{ path: filePath, tool: "Read" }]));

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });

  it("deduplicates file paths", async () => {
    const filePath = join(tempDir, "dup.ts");
    await writeFile(filePath, "export {}");

    const transcriptPath = join(tempDir, "transcript-dup.jsonl");
    await writeFile(
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
    await writeFile(
      transcriptPath,
      createTranscriptContent([{ path: "/nonexistent/deleted.ts", tool: "Write" }]),
    );

    expect(await parseTranscript(transcriptPath)).toEqual([]);
  });
});

describe("categorizeChecks", () => {
  const cwd = "/project";

  it("returns no checks for irrelevant paths", () => {
    const checks = categorizeChecks(["README.md", "package.json"], cwd);
    expect(checks).toEqual([]);
  });

  it("triggers plugin tests for plugin files", () => {
    const checks = categorizeChecks(["plugins/gitlab/skills/ci.md"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Plugin tests: gitlab");
    expect(names).toContain("Skill lint: gitlab");
    expect(names).toContain("Marketplace completeness");
  });

  it("triggers plugin validation for plugin.json", () => {
    const checks = categorizeChecks(["plugins/gitlab/.claude-plugin/plugin.json"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Plugin tests: gitlab");
    expect(names).toContain("Plugin validation: gitlab");
  });

  it("triggers hooks validation for plugin hooks", () => {
    const checks = categorizeChecks(["plugins/gitlab/hooks/hooks.json"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Plugin tests: gitlab");
    expect(names).toContain("Hooks validation: gitlab");
  });

  it("triggers hook tests for .claude/hooks changes", () => {
    const checks = categorizeChecks([".claude/hooks/stop/index.ts"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Hook tests");
  });

  it("triggers hook tests for user/hooks changes", () => {
    const checks = categorizeChecks(["user/hooks/foo.ts"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Hook tests");
  });

  it("triggers settings validation for settings files", () => {
    const checks = categorizeChecks([".claude/settings.json"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Settings validation");
  });

  it("triggers marketplace check for marketplace.json", () => {
    const checks = categorizeChecks([".claude-plugin/marketplace.json"], cwd);
    const names = checkNames(checks);
    expect(names).toContain("Marketplace completeness");
  });

  it("deduplicates checks across multiple files in same plugin", () => {
    const checks = categorizeChecks(
      [
        "plugins/gitlab/skills/ci.md",
        "plugins/gitlab/skills/docs.md",
        "plugins/gitlab/hooks/hooks.json",
      ],
      cwd,
    );
    const names = checkNames(checks);
    const testChecks = names.filter((n) => n === "Plugin tests: gitlab");
    expect(testChecks).toHaveLength(1);
    const lintChecks = names.filter((n) => n === "Skill lint: gitlab");
    expect(lintChecks).toHaveLength(1);
  });

  it("creates separate checks for different plugins", () => {
    const checks = categorizeChecks(
      ["plugins/gitlab/skills/ci.md", "plugins/github/skills/gh.md"],
      cwd,
    );
    const names = checkNames(checks);
    expect(names).toContain("Plugin tests: gitlab");
    expect(names).toContain("Plugin tests: github");
    expect(names).toContain("Skill lint: gitlab");
    expect(names).toContain("Skill lint: github");
  });
});
