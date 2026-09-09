import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { collectFiles, isAgentFacing, shouldSkip, toGlob } from "./scan";

describe("isAgentFacing", () => {
  test.each([
    ["a plugin skill", "plugins/prompting/skills/scan/SKILL.md", true],
    ["a repo instruction file", "CLAUDE.md", true],
    ["an agents file", "nested/AGENTS.md", true],
    ["a project rule", ".claude/rules/plugins.md", true],
    ["a project agent", ".claude/agents/reviewer.md", true],
    ["a skill reference", "plugins/writing/skills/scan/references/tropes.md", true],
    ["a prompt directory", "src/prompts/system.txt", true],
    ["a readme", "plugins/prompting/README.md", false],
    ["source", "plugins/prompting/skills/scan/scripts/scan.ts", false],
  ])("%s", (_label, path, expected) => {
    expect(isAgentFacing(path)).toBe(expected);
  });
});

describe("shouldSkip", () => {
  test.each([
    ["vendored code", "node_modules/pkg/SKILL.md", true],
    ["test fixtures", "plugins/x/fixtures/CLAUDE.md", true],
    ["a real skill", "plugins/x/skills/y/SKILL.md", false],
  ])("%s", (_label, path, expected) => {
    expect(shouldSkip(path)).toBe(expected);
  });
});

describe("toGlob", () => {
  test("walks a directory", () => {
    expect(toGlob(import.meta.dirname)).toEqual({ cwd: import.meta.dirname, pattern: "**/*" });
  });

  test("passes a non-directory through as a pattern", () => {
    expect(toGlob("plugins/**/SKILL.md")).toEqual({ cwd: ".", pattern: "plugins/**/SKILL.md" });
  });
});

describe("collectFiles", () => {
  let root = "";

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "prompting-scan-"));
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    await Promise.all([
      Bun.write(join(root, ".claude/rules/style.md"), "Try to keep it short.\n"),
      Bun.write(join(root, "CLAUDE.md"), "Write it.\n"),
      Bun.write(join(root, "notes.md"), "Write it.\n"),
      Bun.write(join(root, "node_modules/CLAUDE.md"), "Write it.\n"),
    ]);
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${root}`.quiet();
  });

  test("reaches agent-facing files under a dot directory", async () => {
    expect(await collectFiles(root, false)).toEqual([
      join(root, ".claude/rules/style.md"),
      join(root, "CLAUDE.md"),
    ]);
  });

  test("drops the path filter under --all", async () => {
    expect(await collectFiles(root, true)).toContain(join(root, "notes.md"));
  });
});
