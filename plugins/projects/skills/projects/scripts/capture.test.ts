import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  capture,
  primaryRoot,
  readPullRequests,
  readResolutions,
  resolveGitHub,
  type Resolution,
  resolveUrl,
} from "./capture";
import { ago, DAY, NOW, pr, row } from "./fixture";

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

describe("readPullRequests", () => {
  test("looks each distinct pull request up once, and only inside the fortnight", async () => {
    const asked: string[] = [];
    const looked = await readPullRequests(
      [
        row({ branch: "a", pr: "https://pr/1" }),
        row({ branch: "b", pr: "https://pr/1" }),
        row({ branch: "c", ts: ago(NOW, 15 * DAY), pr: "https://pr/2" }),
        row({ branch: "d", ts: ago(NOW, 13 * DAY), pr: "https://pr/3" }),
        row({ branch: "e", ts: "yesterday", pr: "https://pr/4" }),
        row({ branch: "f" }),
      ],
      NOW,
      (url) => {
        asked.push(url);
        return Promise.resolve(pr());
      },
    );
    expect(asked).toEqual(["https://pr/1", "https://pr/3"]);
    expect([...looked.keys()]).toEqual(["https://pr/1", "https://pr/3"]);
  });

  test("asks only about outcomes a thread can still reach the board under", async () => {
    const asked: string[] = [];
    await readPullRequests(
      [
        row({ branch: "a", outcome: "dispatched", pr: "https://pr/dispatched" }),
        row({ branch: "b", outcome: "blocked", pr: "https://pr/blocked" }),
        row({ branch: "c", outcome: "done", pr: "https://pr/done" }),
        row({ branch: "d", outcome: "abandoned", pr: "https://pr/abandoned" }),
        row({ branch: "e", outcome: "orphaned", pr: "https://pr/orphaned" }),
      ],
      NOW,
      (url) => {
        asked.push(url);
        return Promise.resolve(pr());
      },
    );
    expect(asked).toEqual(["https://pr/dispatched", "https://pr/blocked", "https://pr/done"]);
  });

  test("keeps the lookups in flight under a ceiling", async () => {
    let live = 0;
    let peak = 0;
    const rows = Array.from({ length: 40 }, (_, index) =>
      row({ branch: `b${index}`, pr: `https://pr/${index}` }),
    );
    const looked = await readPullRequests(rows, NOW, async (_url) => {
      live += 1;
      peak = Math.max(peak, live);
      await Bun.sleep(1);
      live -= 1;
      return pr();
    });
    expect(looked.size).toBe(40);
    expect(peak).toBe(8);
  });
});

describe("resolvers", () => {
  // gh reads a pull request and an issue under different subcommands.
  const asking = (
    stdout: string | null,
  ): { asked: string[][]; run: (argv: string[]) => Promise<string | null> } => {
    const asked: string[][] = [];
    return {
      asked,
      run: (argv) => {
        asked.push([...argv]);
        return Promise.resolve(stdout);
      },
    };
  };

  test.each<[string, string, string, Resolution]>([
    ["a merged pull request", "MERGED", "pull/12", "closed"],
    ["a closed issue", "CLOSED", "issues/12", "closed"],
    ["an open pull request", "OPEN", "pull/12", "open"],
    ["a state gh does not name", "DRAFT", "pull/12", "unknown"],
  ])("reads %s as %s", async (_label, state, path, expected) => {
    const url = `https://github.com/bendrucker/claude/${path}`;
    const { asked, run } = asking(`{"state":"${state}"}`);
    expect(await resolveGitHub(new URL(url), run)).toBe(expected);
    expect(asked).toEqual([
      ["gh", path.startsWith("pull") ? "pr" : "issue", "view", url, "--json", "state"],
    ]);
  });

  test.each<[string, string | null]>([
    ["a gh that could not answer", null],
    ["a gh that answered with something other than JSON", "not json"],
    ["a gh that answered with a shape the resolver does not read", "{}"],
  ])("resolves %s to unknown", async (_label, stdout) => {
    const { run } = asking(stdout);
    expect(await resolveGitHub(new URL("https://github.com/bendrucker/claude/pull/12"), run)).toBe(
      "unknown",
    );
  });

  test.each<[string, string]>([
    ["a host nothing can read", "https://linear.app/ben/issue/ENG-1"],
    ["a github path that is neither", "https://github.com/bendrucker/claude"],
    ["something that is not a url", "not a url"],
  ])("resolves %s to unknown", async (_label, url) => {
    expect(await resolveUrl(url)).toBe("unknown");
  });

  test("looks up only the urls a resolver knows", async () => {
    const asked: string[] = [];
    const looked = await readResolutions(
      [
        "https://github.com/bendrucker/claude/pull/1",
        "https://linear.app/ben/issue/ENG-1",
        "not a url",
      ],
      (url) => {
        asked.push(url);
        return Promise.resolve("open");
      },
    );
    expect(asked).toEqual(["https://github.com/bendrucker/claude/pull/1"]);
    expect([...looked.keys()]).toEqual(["https://github.com/bendrucker/claude/pull/1"]);
  });
});
