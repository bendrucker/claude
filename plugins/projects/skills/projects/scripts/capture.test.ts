import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { capture, primaryRoot } from "./capture";

describe("capture", () => {
  test("gives up on a command that outruns its deadline", async () => {
    const started = Date.now();
    expect(await capture(["sleep", "30"], 100)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("primaryRoot", () => {
  test("folds a linked worktree and a subdirectory onto the main worktree", async () => {
    const main = mkdtempSync(join(tmpdir(), "ledger-repo-"));
    const git = (...args: string[]) => Bun.spawn(["git", "-C", main, ...args]).exited;
    await git("init", "-q");
    await git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    mkdirSync(join(main, "sub"));
    const linked = join(main, "sub", "linked");
    await git("worktree", "add", "-q", linked, "-b", "linked");
    const root = await primaryRoot(main);
    expect(root).not.toBe(linked);
    expect(await primaryRoot(linked)).toBe(root);
    expect(await primaryRoot(join(main, "sub"))).toBe(root);
  });

  test("returns a path git does not know as given", async () => {
    expect(await primaryRoot("/nonexistent/repo")).toBe("/nonexistent/repo");
  });
});
