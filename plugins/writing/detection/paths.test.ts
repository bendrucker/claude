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

  test("a repo checked out under a tmp-named ancestor is not scratch", () => {
    expect(isScratchPath("/Users/x/tmp/myproject/README.md", "/Users/x/tmp/myproject")).toBe(false);
  });

  test("a tmp dir below such a repo still is", () => {
    expect(isScratchPath("/Users/x/tmp/myproject/tmp/note.md", "/Users/x/tmp/myproject")).toBe(
      true,
    );
  });

  test("paths outside the working tree are not scratch by segment", () => {
    expect(isScratchPath("/Users/x/other/tmp/doc.md", "/Users/x/myproject")).toBe(false);
  });

  test("TMPDIR contents are scratch", () => {
    const tmpDir = process.env.TMPDIR;
    if (!tmpDir) return;
    expect(isScratchPath(`${resolve(tmpDir)}/handoff.md`)).toBe(true);
  });
});
