import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { PluginHistory } from "./history";
import { loadHistory } from "./history";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

async function names(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, "plugins"), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function find(history: Map<string, PluginHistory>, name: string): PluginHistory {
  const entry = history.get(name);
  if (!entry) throw new Error(`plugin ${name} has no history`);
  return entry;
}

describe("loadHistory", () => {
  test("follows rename lineage into a plugin whose predecessor no longer exists", async () => {
    const history = await loadHistory(await names());
    expect(history.get("issue")?.firstCommit).toBe("2026-01-09");
    expect(history.get("writing")?.firstCommit).toBe("2026-01-13");
  });

  test("rejects a rename whose source plugin still exists at HEAD", async () => {
    const history = await loadHistory(await names());
    // A file under plugins/claude-code/ was renamed into plugins/writing/ in a
    // commit well after writing's real first commit. claude-code still exists
    // on disk, so that rename must not pull claude-code's (earlier) history
    // into writing's lineage.
    const writing = find(history, "writing");
    const claudeCode = find(history, "claude-code");
    expect(writing.firstCommit > claudeCode.firstCommit).toBe(true);
  });

  test("throws on a shallow clone instead of returning bogus dates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "history-shallow-"));
    try {
      // Pinned so the clone does not inherit a working directory that another
      // test file may have removed out from under the shared test process.
      await $`git clone --depth 1 --quiet file://${REPO_ROOT} ${dir}`.cwd(REPO_ROOT).quiet();
      await expect(loadHistory(["issue"], { root: dir })).rejects.toThrow(/shallow/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
