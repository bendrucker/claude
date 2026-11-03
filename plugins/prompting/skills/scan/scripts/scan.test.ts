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
    expect([...(await scan([root], false)).alerts.keys()].toSorted()).toEqual(
      agentFacing.map((path) => join(root, path)).toSorted(),
    );
  });

  test("reads every document under --all", async () => {
    expect([...(await scan([root], true)).alerts.keys()].toSorted()).toEqual(
      [...agentFacing, "README.md"].map((path) => join(root, path)).toSorted(),
    );
  });

  test("filters an explicit path the same way", async () => {
    const readme = join(root, "README.md");
    expect((await scan([readme], false)).alerts.size).toBe(0);
    expect([...(await scan([readme], true)).alerts.keys()]).toEqual([readme]);
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
    expect(fails((await scan([join(dir, name)], false)).alerts)).toBe(expected);
  });
});

describe("scan following imports", () => {
  let tmp = "";
  let root = "";
  const flagged = "Try to keep it short.\n";

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "prompting-imports-"));
    root = join(tmp, "project");
    const files: Record<string, string> = {
      "CLAUDE.md": [
        "See @docs/a.md for access control.",
        "@AGENTS.md",
        "@chain/1.md",
        "@../sibling.md",
        "@docs/missing.md",
        "",
        "```",
        "@docs/fenced.md",
        "```",
        "",
        "Mention `@docs/inline.md` without loading it, or mail me@docs/email.md.",
        "",
      ].join("\n"),
      "AGENTS.md": `${flagged}@CLAUDE.md\n`,
      "docs/a.md": `${flagged}@b.md\n`,
      "docs/b.md": `${flagged}@a.md\n`,
      "docs/fenced.md": flagged,
      "docs/inline.md": flagged,
      "docs/email.md": flagged,
      "chain/1.md": `${flagged}@2.md\n`,
      "chain/2.md": `${flagged}@3.md\n`,
      "chain/3.md": `${flagged}@4.md\n`,
      "chain/4.md": `${flagged}@5.md\n`,
      "chain/5.md": flagged,
    };
    await Promise.all([
      ...Object.entries(files).map(([path, text]) => Bun.write(join(root, path), text)),
      Bun.write(join(tmp, "sibling.md"), flagged),
    ]);
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${tmp}`.quiet();
  });

  test.each([
    ["the root", ".", false],
    ["CLAUDE.md", "CLAUDE.md", false],
    ["CLAUDE.md under --all", "CLAUDE.md", true],
  ])("lints imports within four hops of %s, once each", async (_label, path, all) => {
    const { alerts } = await scan([join(root, path)], all);
    expect([...alerts.keys()].toSorted()).toEqual(
      [
        "AGENTS.md",
        "chain/1.md",
        "chain/2.md",
        "chain/3.md",
        "chain/4.md",
        "docs/a.md",
        "docs/b.md",
      ]
        .map((file) => join(root, file))
        .toSorted(),
    );
    expect(alerts.get(join(root, "AGENTS.md"))).toHaveLength(1);
  });

  test("reports imports it cannot scan", async () => {
    const { unscanned } = await scan([root], false);
    expect(unscanned).toEqual([
      { from: join(root, "CLAUDE.md"), path: "../sibling.md", reason: "outside the scanned paths" },
      { from: join(root, "CLAUDE.md"), path: "docs/missing.md", reason: "missing" },
    ]);
  });
});
