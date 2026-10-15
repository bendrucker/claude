import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = join(import.meta.dir, "..", "create-scenarios", "stubs.sh");

let home: string;
let repo: string;

function run(cmd: string, args: string[], input?: string) {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: repo,
    env: { ...process.env, HOME: home },
    stdin: input === undefined ? undefined : new TextEncoder().encode(input),
  });
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

const stub = (tool: string) => join(home, ".local", "stub", tool);

const block = (title: string, body: string, url: string) =>
  `PR-TITLE: ${title}\nPR-BODY-BEGIN\n${body}\nPR-BODY-END\n${url}\n`;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "stubs-home-"));
  repo = mkdtempSync(join(tmpdir(), "stubs-repo-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  Bun.spawnSync(["git", "remote", "add", "origin", "https://gitlab.com/team/service.git"], {
    cwd: repo,
  });
  const install = Bun.spawnSync(["bash", installer], { env: { ...process.env, HOME: home } });
  expect(install.exitCode).toBe(0);
});

describe("installer", () => {
  test("writes executable glab and gh and puts them first on PATH via .zshenv", async () => {
    for (const tool of ["glab", "gh"]) {
      expect(Bun.spawnSync(["test", "-x", stub(tool)]).exitCode).toBe(0);
    }
    expect(await Bun.file(join(home, ".zshenv")).text()).toContain(
      `export PATH="${join(home, ".local", "stub")}:$PATH"`,
    );
  });
});

describe("glab mr create", () => {
  const url = "https://gitlab.com/team/service/-/merge_requests/1";

  test.each([
    ["-t and -d", ["-t", "T", "-d", "Body"]],
    ["--title and --description", ["--title", "T", "--description", "Body"]],
    ["--flag=value forms", ["--title=T", "--description=Body"]],
    ["-b", ["-t", "T", "-b", "Body"]],
    ["--body=value", ["--title=T", "--body=Body"]],
  ])("prints the block for %s", (_, flags) => {
    const r = run(stub("glab"), ["mr", "create", "--yes", ...flags]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(block("T", "Body", url));
  });

  test("reads the body from a file", async () => {
    const file = join(repo, "body.md");
    await Bun.write(file, "From file\n\nSecond block");
    for (const flags of [
      ["-F", file],
      ["--body-file", file],
      [`--body-file=${file}`],
      ["--description-file", file],
      [`--description-file=${file}`],
    ]) {
      const r = run(stub("glab"), ["mr", "create", "-t", "T", ...flags]);
      expect(r.out).toBe(block("T", "From file\n\nSecond block", url));
    }
  });

  test.each([["-F"], ["-d"], ["--description"]])("reads the body from stdin for %s -", (flag) => {
    const r = run(stub("glab"), ["mr", "create", "-t", "T", flag, "-"], "Piped\n- a\n- b");
    expect(r.out).toBe(block("T", "Piped\n- a\n- b", url));
  });

  test("keeps a multi-line body verbatim", () => {
    const body = "Why.\n\n- one\n- two\n\n## Heading";
    const r = run(stub("glab"), ["mr", "create", "-t", "T", "-d", body]);
    expect(r.out).toBe(block("T", body, url));
  });
});

describe("gh pr create", () => {
  test("derives the URL from an ssh origin", () => {
    Bun.spawnSync(["git", "remote", "set-url", "origin", "git@github.com:bendrucker/claude.git"], {
      cwd: repo,
    });
    const r = run(stub("gh"), ["pr", "create", "--title", "T", "--body", "Body"]);
    expect(r.out).toBe(block("T", "Body", "https://github.com/bendrucker/claude/pull/1"));
  });
});

describe("other subcommands", () => {
  test.each([
    ["glab", ["mr", "list"]],
    ["gh", ["pr", "view", "1"]],
    ["gh", ["api", "repos/x/y"]],
  ])("%s %j fails offline", (tool, args) => {
    const r = run(stub(tool), args);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(`${tool} stand-in: ${args.join(" ")} is unavailable offline\n`);
  });
});
