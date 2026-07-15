import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { loadHistory } from "./history";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

async function names(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, "plugins"), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

describe("loadHistory", () => {
  test("follows rename lineage into a plugin whose predecessor no longer exists", async () => {
    const history = await loadHistory(await names());
    expect(history.get("issue")?.firstCommit).toBe("2026-01-09");
    expect(history.get("writing")?.firstCommit).toBe("2026-01-13");
  });

  test("rejects a rename whose source plugin still exists at HEAD", async () => {
    const history = await loadHistory(await names());
    const writing = history.get("writing");
    const claudeCode = history.get("claude-code");
    expect(writing).toBeDefined();
    expect(claudeCode).toBeDefined();
    // A file under plugins/claude-code/ was renamed into plugins/writing/ in a
    // commit well after writing's real first commit. claude-code still exists
    // on disk, so that rename must not pull claude-code's (earlier) history
    // into writing's lineage.
    expect(writing!.firstCommit > claudeCode!.firstCommit).toBe(true);
  });

  test("throws on a shallow clone instead of returning bogus dates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "history-shallow-"));
    try {
      await $`git clone --depth 1 --quiet file://${REPO_ROOT} ${dir}`.quiet();
      await expect(loadHistory(["issue"], { root: dir })).rejects.toThrow(/shallow/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
