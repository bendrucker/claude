import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { spawnRunner } from "./dispatch";
import { resolveRepo } from "./repo";

// Runs the real gh against GitHub. The fork case uses a repository the viewer
// already forked, so gh reuses that fork rather than creating one.
const PUSHABLE = process.env.DISPATCH_PUSHABLE_REPO ?? "bendrucker/.github";
const FORKED = process.env.DISPATCH_FORKED_REPO ?? "chinedufn/choo-test-onclick-example";

async function git(path: string, ...args: string[]): Promise<string> {
  const result = await spawnRunner(["git", "-C", path, ...args]);
  expect(result.code).toBe(0);
  return result.stdout.trim();
}

describe("resolveRepo against GitHub", () => {
  test("clones a repository the viewer can push to with origin upstream", async () => {
    const home = mkdtempSync(join(tmpdir(), "dispatch-clone-"));
    const path = await resolveRepo(PUSHABLE, spawnRunner, home);
    expect(path).toBe(join(home, "src", ...PUSHABLE.split("/")));
    expect(await git(path, "remote", "get-url", "origin")).toContain(PUSHABLE);
    expect(await git(path, "remote")).not.toContain("upstream");
  }, 120_000);

  test("clones the viewer's fork into the upstream owner's directory", async () => {
    const home = mkdtempSync(join(tmpdir(), "dispatch-fork-"));
    const [owner = "", name = ""] = FORKED.split("/");
    const path = await resolveRepo(`https://github.com/${FORKED}`, spawnRunner, home);
    expect(path).toBe(join(home, "src", owner, name));
    expect(await git(path, "remote", "get-url", "upstream")).toContain(FORKED);
    expect(await git(path, "remote", "get-url", "origin")).not.toContain(`${owner}/`);
    expect(await git(path, "symbolic-ref", "--short", "refs/remotes/upstream/HEAD")).toMatch(
      /^upstream\//,
    );
  }, 120_000);
});
