import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { isScratchPath } from "./paths";

describe("isScratchPath", () => {
  test.each<{ name: string; filePath: string; scratch: boolean }>([
    { name: "repo-relative tmp/", filePath: "tmp/notes.md", scratch: true },
    { name: "nested working-tree tmp/", filePath: "packages/app/tmp/plan.md", scratch: true },
    { name: "system /tmp", filePath: "/tmp/pr-body.md", scratch: true },
    { name: "resolved private tmp", filePath: "/private/tmp/claude/x.md", scratch: true },
    {
      name: "background job dir",
      filePath: `${process.env.HOME}/.claude/jobs/e94f65d4/tmp/query.sh`,
      scratch: true,
    },
    {
      name: "background job file outside its tmp",
      filePath: `${process.env.HOME}/.claude/jobs/e94f65d4/notes.md`,
      scratch: true,
    },
    { name: "repo README", filePath: "README.md", scratch: false },
    { name: "docs file named tmp.md", filePath: "docs/tmp.md", scratch: false },
    { name: "tmp-prefixed directory", filePath: "/Users/ben/src/tmpfoo/x.md", scratch: false },
    { name: "skill file", filePath: "plugins/writing/skills/scan/SKILL.md", scratch: false },
  ])("$name → $scratch", ({ filePath, scratch }) => {
    expect(isScratchPath(filePath)).toBe(scratch);
  });

  test("TMPDIR contents are scratch", () => {
    const tmpDir = process.env.TMPDIR;
    if (!tmpDir) return;
    expect(isScratchPath(`${resolve(tmpDir)}/handoff.md`)).toBe(true);
  });
});
