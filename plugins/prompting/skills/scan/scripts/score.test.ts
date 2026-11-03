import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_FACING, DOCUMENTS, scan } from "./scan";
import { documents, renderScores, rootLabel, scoreFiles, wordCount } from "./score";

describe("wordCount", () => {
  test.each([
    ["plain prose", "Keep the summary short.\n", 4],
    ["frontmatter", "---\nname: x\ndescription: a long one\n---\n\nRun it.\n", 2],
    ["fenced code", "Run it:\n\n```bash\nbun scan.ts --all --quiet\n```\n", 2],
    ["indented code", "Run it:\n\n    bun scan.ts --all\n", 2],
    ["an inline code span as one word", "Run `bun scan.ts --all` now.\n", 3],
    ["link text without the URL", "See [the docs](https://example.com/a/b).\n", 3],
    ["contractions and hyphens", "Don't re-run the per-file pass.\n", 5],
    ["markup", "# Title\n\n- one\n- **two**\n", 3],
    ["HTML", "<!-- a hidden note -->\n\nShown.\n", 1],
  ])("counts %s", (_label, text, expected) => {
    expect(wordCount(text)).toBe(expected);
  });
});

describe("rootLabel", () => {
  test.each([
    ["relative to a single root", "/org/a/CLAUDE.md", ["/org/a"], "CLAUDE.md"],
    [
      "under the root's name across roots",
      "/org/b/x/SKILL.md",
      ["/org/a", "/org/b"],
      "b/x/SKILL.md",
    ],
    ["against the deepest root", "/org/a/x/SKILL.md", ["/org", "/org/a/x"], "x/SKILL.md"],
    ["absolute outside every root", "/elsewhere/CLAUDE.md", ["/org/a"], "/elsewhere/CLAUDE.md"],
    ["without matching a root's name prefix", "/org/ab/CLAUDE.md", ["/org/a"], "/org/ab/CLAUDE.md"],
  ])("labels %s", (_label, path, roots, expected) => {
    expect(rootLabel(path, roots)).toBe(expected);
  });
});

describe("scoring a scan", () => {
  let root = "";

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "prompting-score-"));
    await Promise.all([
      Bun.write(join(root, "a/CLAUDE.md"), "Try to keep it short. Wait for #123.\n"),
      Bun.write(join(root, "a/README.md"), "Try to keep it short.\n"),
      Bun.write(join(root, "a/node_modules/pkg/CLAUDE.md"), "Try to keep it short.\n"),
      Bun.write(join(root, "a/evals/CLAUDE.md"), "Try to keep it short.\n"),
      Bun.write(
        join(root, "b/.claude/rules/style.md"),
        "Keep the summary to three lines.\n\n```\ncode words here do not count\n```\n",
      ),
      Bun.write(join(root, "b/empty/SKILL.md"), "```\nonly code\n```\n"),
    ]);
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${root}`.quiet();
  });

  test("walks the documents the glob matches, skipping the scan's skipped directories", async () => {
    const roots = [join(root, "a"), join(root, "b")];
    expect((await documents(roots, AGENT_FACING)).toSorted()).toEqual(
      ["a/CLAUDE.md", "b/.claude/rules/style.md", "b/empty/SKILL.md"].map((path) =>
        join(root, path),
      ),
    );
    expect(await documents([join(root, "a")], `**/${DOCUMENTS}`)).toContain(
      join(root, "a/README.md"),
    );
  });

  test("renders a row per file, clean ones included, and a total", async () => {
    const paths = [join(root, "a"), join(root, "b")];
    const { alerts, imports } = await scan(paths, false);
    const files = await documents(paths, AGENT_FACING);
    const scores = await scoreFiles([...files, ...imports], alerts);
    expect(renderScores(scores, paths)).toMatchInlineSnapshot(`
      "╔══════════════════════════╤════════╤═══════╤════════╗
      ║ File                     │ Alerts │ Words │ Per 1k ║
      ╟──────────────────────────┼────────┼───────┼────────╢
      ║ a/CLAUDE.md              │      2 │     8 │ 250.00 ║
      ║ b/.claude/rules/style.md │      0 │     6 │   0.00 ║
      ║ b/empty/SKILL.md         │      0 │     0 │   0.00 ║
      ╟──────────────────────────┼────────┼───────┼────────╢
      ║ Total                    │      2 │    14 │ 142.86 ║
      ╚══════════════════════════╧════════╧═══════╧════════╝"
    `);
  });
});
