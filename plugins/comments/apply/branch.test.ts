import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { applyToBranch } from "./branch";

/** A fresh git repo with a normal file and an executable shell script committed. */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "comments-branch-"));
  const git = (...args: string[]) =>
    $`git ${args}`
      .cwd(dir)
      .env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" })
      .quiet();
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await Bun.write(join(dir, "note.ts"), "// keep\n// slop\nconst x = 1;\n");
  await Bun.write(join(dir, "run.sh"), "#!/bin/sh\necho hi\n");
  await $`chmod 755 run.sh`.cwd(dir).quiet();
  await git("add", "note.ts", "run.sh");
  await git("commit", "-m", "init");
  return dir;
}

describe("applyToBranch", () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    dir = await makeRepo();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  });

  test("creates the branch at a new commit carrying the edit", async () => {
    await applyToBranch(new Map([["note.ts", "// keep\nconst x = 1;\n"]]), { branch: "audit" });

    const parent = (await $`git rev-parse HEAD`.quiet()).text().trim();
    const branchParent = (await $`git rev-parse audit^`.quiet()).text().trim();
    expect(branchParent).toBe(parent);

    const edited = (await $`git show audit:note.ts`.quiet()).text();
    expect(edited).toBe("// keep\nconst x = 1;\n");
  });

  test("leaves the working tree and current branch untouched", async () => {
    const headBefore = (await $`git rev-parse HEAD`.quiet()).text().trim();

    await applyToBranch(new Map([["note.ts", "// keep\nconst x = 1;\n"]]), { branch: "audit" });

    const status = (await $`git status --porcelain`.quiet()).text().trim();
    expect(status).toBe("");
    const current = (await $`git branch --show-current`.quiet()).text().trim();
    expect(current).toBe("main");
    const headAfter = (await $`git rev-parse HEAD`.quiet()).text().trim();
    expect(headAfter).toBe(headBefore);
  });

  test("preserves the executable mode of a shell script", async () => {
    await applyToBranch(new Map([["run.sh", "#!/bin/sh\necho bye\n"]]), { branch: "audit" });

    const entry = (await $`git ls-tree audit run.sh`.quiet()).text().trim();
    expect(entry.split(/\s+/)[0]).toBe("100755");
  });

  test("surfaces a clear error on re-apply and leaves a clean tree", async () => {
    const edits = new Map([["note.ts", "// keep\nconst x = 1;\n"]]);
    await applyToBranch(edits, { branch: "audit" });

    expect(applyToBranch(edits, { branch: "audit" })).rejects.toThrow(/audit/);

    const status = (await $`git status --porcelain`.quiet()).text().trim();
    expect(status).toBe("");
    const current = (await $`git branch --show-current`.quiet()).text().trim();
    expect(current).toBe("main");
  });
});
