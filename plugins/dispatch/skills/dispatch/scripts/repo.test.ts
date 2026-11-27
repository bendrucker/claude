import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CommandResult, Runner } from "./dispatch";
import { parseRepoSpec, type RepoSpec, resolveRepo } from "./repo";

const ok = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });

function fakeRunner(responses: readonly CommandResult[]): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (argv) => {
    calls.push([...argv]);
    const response = responses[calls.length - 1];
    if (response == null) throw new Error(`unscripted call: ${argv.join(" ")}`);
    return Promise.resolve(response);
  };
  return { run, calls };
}

async function rejectionOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

const repo = (
  owner: string,
  name: string,
  permission: string,
  parent: { owner: string; name: string } | null = null,
) =>
  ok(
    JSON.stringify({
      name,
      owner: { login: owner },
      parent: parent == null ? null : { name: parent.name, owner: { login: parent.owner } },
      viewerPermission: permission,
      defaultBranchRef: { name: "main" },
    }),
  );

const slug = (owner: string, name: string): RepoSpec => ({ kind: "slug", slug: { owner, name } });

describe("parseRepoSpec", () => {
  const home = mkdtempSync(join(tmpdir(), "dispatch-repo-"));
  const existing = join(home, "src", "acme", "widget");
  mkdirSync(existing, { recursive: true });

  test.each<{ name: string; spec: string; expected: RepoSpec }>([
    { name: "an existing path", spec: existing, expected: { kind: "path", path: existing } },
    {
      name: "a slug",
      spec: "backnotprop/plannotator",
      expected: slug("backnotprop", "plannotator"),
    },
    {
      name: "an HTTPS URL",
      spec: "https://github.com/backnotprop/plannotator.git",
      expected: slug("backnotprop", "plannotator"),
    },
    {
      name: "an scp-style SSH URL",
      spec: "git@github.com:backnotprop/plannotator.git",
      expected: slug("backnotprop", "plannotator"),
    },
    {
      name: "a missing path under ~/src",
      spec: join(home, "src", "bendrucker", "plannotator"),
      expected: slug("bendrucker", "plannotator"),
    },
  ])("reads $name", async ({ spec, expected }) => {
    expect(await parseRepoSpec(spec, home)).toEqual(expected);
  });

  test.each([
    ["a missing path outside ~/src", "/nowhere/at/all"],
    ["a missing path nested deeper than ~/src/<owner>/<name>", "/x/src/a/b/c"],
    ["a URL on another host", "https://gitlab.com/acme/widget"],
  ])("refuses %s", async (_, spec) => {
    expect(await rejectionOf(parseRepoSpec(spec, home))).toMatch(/does not exist/);
  });
});

describe("resolveRepo", () => {
  const freshHome = () => mkdtempSync(join(tmpdir(), "dispatch-home-"));

  test("returns an existing path without calling anything", async () => {
    const home = freshHome();
    const { run, calls } = fakeRunner([]);
    expect(await resolveRepo(home, run, home)).toBe(home);
    expect(calls).toEqual([]);
  });

  test("clones a repository you can push to under its owner", async () => {
    const home = freshHome();
    const path = join(home, "src", "acme", "widget");
    const { run, calls } = fakeRunner([repo("acme", "widget", "WRITE"), ok("")]);
    expect(await resolveRepo("acme/widget", run, home)).toBe(path);
    expect(calls[1]).toEqual(["gh", "repo", "clone", "acme/widget", path]);
  });

  test("forks into the upstream owner's directory when you cannot push", async () => {
    const home = freshHome();
    const path = join(home, "src", "backnotprop", "plannotator");
    const { run, calls } = fakeRunner([repo("backnotprop", "plannotator", "READ"), ok(""), ok("")]);
    expect(await resolveRepo("backnotprop/plannotator", run, home)).toBe(path);
    expect(calls.slice(1)).toEqual([
      ["gh", "repo", "fork", "backnotprop/plannotator", "--clone", "--", path],
      ["git", "-C", path, "remote", "set-head", "upstream", "main"],
    ]);
  });

  test("resolves a fork's slug to its parent's directory", async () => {
    const home = freshHome();
    const parent = { owner: "backnotprop", name: "plannotator" };
    const { run, calls } = fakeRunner([
      repo("bendrucker", "plannotator", "ADMIN", parent),
      repo("backnotprop", "plannotator", "READ"),
      ok(""),
      ok(""),
    ]);
    const path = await resolveRepo(join(home, "src", "bendrucker", "plannotator"), run, home);
    expect(path).toBe(join(home, "src", "backnotprop", "plannotator"));
    expect(calls[2]?.slice(0, 4)).toEqual(["gh", "repo", "fork", "backnotprop/plannotator"]);
  });

  test("reuses the upstream checkout once it exists", async () => {
    const home = freshHome();
    const path = join(home, "src", "backnotprop", "plannotator");
    mkdirSync(path, { recursive: true });
    const { run, calls } = fakeRunner([repo("backnotprop", "plannotator", "READ")]);
    expect(await resolveRepo("backnotprop/plannotator", run, home)).toBe(path);
    expect(calls).toHaveLength(1);
  });

  test("forwards what gh reports when the clone fails", async () => {
    const home = freshHome();
    const { run } = fakeRunner([
      repo("acme", "widget", "WRITE"),
      fail("fatal: could not read from remote"),
    ]);
    expect(await rejectionOf(resolveRepo("acme/widget", run, home))).toMatch(
      /could not read from remote/,
    );
  });
});
