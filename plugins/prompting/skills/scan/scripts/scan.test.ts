import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fails, scan } from "./scan";

describe("scan", () => {
  let root = "";
  const agentFacing = [
    ".claude/rules/style.md",
    "CLAUDE.md",
    "nested/AGENTS.md",
    "plugins/x/skills/y/SKILL.md",
    "plugins/x/skills/y/references/guide.md",
    "src/prompts/system.txt",
  ];
  const skipped = [
    "node_modules/pkg/CLAUDE.md",
    "plugins/x/fixtures/CLAUDE.md",
    "plugins/x/__snapshots__/SKILL.md",
  ];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "prompting-scan-"));
    await Promise.all([
      ...[...agentFacing, "README.md", ...skipped].map((path) =>
        Bun.write(join(root, path), "Try to keep it short.\n"),
      ),
      Bun.write(join(root, "build.ts"), "// Try to keep it short.\n"),
    ]);
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${root}`.quiet();
  });

  test("reads agent-facing documents, including under a dot directory", async () => {
    expect([...(await scan([root], false)).keys()].toSorted()).toEqual(
      agentFacing.map((path) => join(root, path)).toSorted(),
    );
  });

  test("reads every document under --all", async () => {
    expect([...(await scan([root], true)).keys()].toSorted()).toEqual(
      [...agentFacing, "README.md"].map((path) => join(root, path)).toSorted(),
    );
  });

  test("filters an explicit path the same way", async () => {
    const readme = join(root, "README.md");
    expect((await scan([readme], false)).size).toBe(0);
    expect([...(await scan([readme], true)).keys()]).toEqual([readme]);
  });
});

describe("fails", () => {
  let dir = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "prompting-fails-"));
    await Promise.all([
      Bun.write(join(dir, "clean/CLAUDE.md"), "Wait for the release.\n"),
      Bun.write(join(dir, "warn/CLAUDE.md"), "Wait for #123.\n"),
      Bun.write(join(dir, "draft/evals/CLAUDE.md"), "Wait for #123.\n"),
      Bun.write(join(dir, "error/CLAUDE.md"), "Wait for #123. Try to wait.\n"),
    ]);
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test.each([
    ["passes with no alerts", "clean", false],
    ["fails on a warning", "warn", true],
    ["skips an eval draft", "draft", false],
    ["fails on an error", "error", true],
  ])("%s", async (_label, name, expected) => {
    expect(fails(await scan([join(dir, name)], false))).toBe(expected);
  });
});
