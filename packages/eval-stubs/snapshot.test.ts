import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { parseWrite, requestUrl } from "./echo";
import { commits, Fields, fileDiffs, flag, parseArgs } from "./snapshot";

describe("parseArgs", () => {
  test("keeps booleans standalone and gives every other flag the next argument", () => {
    const args = parseArgs(
      ["view", "7", "--json", "title", "--comments", "-q", ".x", "--repo=a/b", "-"],
      new Set(["--comments"]),
    );
    expect(args.positional).toEqual(["view", "7", "-"]);
    expect(flag(args, "--json")).toBe("title");
    expect(flag(args, "--comments")).toBe("true");
    expect(flag(args, "--jq", "-q")).toBe(".x");
    expect(flag(args, "-R", "--repo")).toBe("a/b");
  });

  test("returns the last value of a repeated flag", () => {
    expect(flag(parseArgs(["-f", "a=1", "-f", "a=2"], new Set()), "-f")).toBe("a=2");
  });
});

describe("Fields", () => {
  const meta = new Fields({ a: "x", n: 1, list: [{ b: true }], none: null }, "meta");

  test("reads typed values and defaults", () => {
    expect(meta.string("a")).toBe("x");
    expect(meta.number("n")).toBe(1);
    expect(meta.string("missing", "d")).toBe("d");
    expect(meta.list("list")[0]?.boolean("b")).toBe(true);
    expect(meta.list("absent", [])).toEqual([]);
    expect(meta.nullableNumber("none")).toBeNull();
    expect(meta.nullableString("missing")).toBeNull();
  });
});

describe("parseWrite", () => {
  test.each<[string[], { title: string; body: string }]>([
    [["-t", "T", "-d", "B"], { title: "T", body: "B" }],
    [["--title=T", "--body=-"], { title: "T", body: "-" }],
    [["--yes", "--title", "T"], { title: "T", body: "" }],
  ])("%j", (argv, expected) => {
    expect(parseWrite(argv)).toEqual(expected);
  });
});

describe("requestUrl", () => {
  test.each([
    ["gh", "https://github.com/a/b.git", "https://github.com/a/b/pull/1"],
    ["gh", "git@github.com:a/b.git", "https://github.com/a/b/pull/1"],
    ["glab", "https://gitlab.com/g/s/p.git\n", "https://gitlab.com/g/s/p/-/merge_requests/1"],
  ] as const)("%s %s", (tool, remote, url) => {
    expect(requestUrl(tool, remote)).toBe(url);
  });
});

describe("repo reads", () => {
  test("report renames, additions, and commits oldest first", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-stubs-diff-"));
    const git = (...args: string[]) =>
      $`git -c user.name=t -c user.email=t@t -c commit.gpgsign=false ${args}`.cwd(root).quiet();
    await git("init", "-q");
    await Bun.write(join(root, "old.txt"), "same\ncontent\nhere\n");
    await git("add", "-A");
    await git("commit", "-qm", "base");
    const base = (await $`git rev-parse HEAD`.cwd(root).text()).trim();
    await git("mv", "old.txt", "new.txt");
    await Bun.write(join(root, "added.txt"), "one\n");
    await git("add", "-A");
    await git("commit", "-qm", "rename\n\nwith a body");
    const diffs = fileDiffs(root, base, "HEAD");
    expect(diffs.map((d) => [d.status, d.oldPath, d.newPath, d.additions])).toEqual([
      ["added", "added.txt", "added.txt", 1],
      ["renamed", "old.txt", "new.txt", 0],
    ]);
    expect(diffs[0]?.patch.startsWith("@@")).toBe(true);
    expect(commits(root, base, "HEAD").map((c) => c.message)).toEqual(["rename\n\nwith a body"]);
  });
});
