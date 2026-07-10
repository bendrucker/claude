import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const script = join(import.meta.dir, "prek-check.sh");
const repoRoot = join(import.meta.dir, "..");

interface RunResult {
  exitCode: number;
  stderr: string;
}

async function run(...args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bash", script, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr };
}

describe("prek-check plugin-validate", () => {
  it.each<[string, string]>([
    [
      "relative path pointing outside the tree",
      "../../other/plugins/foo/.claude-plugin/plugin.json",
    ],
    ["absolute path", "/abs/plugins/foo/.claude-plugin/plugin.json"],
  ])("skips a %s without ENOENT", async (_name, path) => {
    const { exitCode, stderr } = await run("plugin-validate", path);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("ENOENT");
  });

  it("still validates a real in-tree plugin", async () => {
    const { exitCode } = await run("plugin-validate", "plugins/mac/.claude-plugin/plugin.json");
    expect(exitCode).toBe(0);
  });
});
