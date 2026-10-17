import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const SOURCES = ["echo.ts", "gh.ts", "glab.ts", "snapshot.ts", "install.sh", "preamble.sh"];

// A --check module: one verdict line per body, from its word count.
const CHECK = `export default (body: string) => [\`WORDS \${body.split(/\\s+/).length <= 3 ? "pass" : "fail"}\`];\n`;

interface Home {
  home: string;
  cwd: string;
}

/** A run home whose stand-ins were bundled from a copy of the package with no node_modules above it. */
async function install(args: string[] = []): Promise<Home> {
  const stage = mkdtempSync(join(tmpdir(), "eval-stubs-stage-"));
  await Promise.all([
    ...SOURCES.map(async (f) => Bun.write(join(stage, f), Bun.file(join(import.meta.dir, f)))),
    Bun.write(join(stage, "check.ts"), CHECK),
  ]);
  const home = mkdtempSync(join(tmpdir(), "eval-stubs-home-"));
  const cwd = join(home, "cwd");
  mkdirSync(cwd);
  const flags = args.map((a) => (a === "check.ts" ? join(stage, a) : a));
  const proc = Bun.spawnSync(["bash", join(stage, "install.sh"), ...flags], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: tmpdir() },
  });
  expect(proc.stderr.toString()).toBe("");
  expect(proc.exitCode).toBe(0);
  await $`rm -rf ${stage}`;
  return { home, cwd };
}

/** Builds a repo with the shared preamble: a base commit on main and two on `feature`. */
async function scaffold(cwd: string, remote: string): Promise<{ base: string; head: string }> {
  const script = `
    source ${join(import.meta.dir, "preamble.sh")} ${remote}
    echo one > a.txt
    BASE=$(commit 2026-09-01T10:00:00Z "app: start")
    git update-ref refs/remotes/origin/main "$BASE"
    git switch -qc feature
    echo two >> a.txt
    commit_as "Dana Kim" dana@acme.dev 2026-09-02T10:00:00Z "app: second line" > /dev/null
    echo new > b.txt
    HEAD_SHA=$(commit_as "Dana Kim" dana@acme.dev 2026-09-03T10:00:00Z "app: add b")
    echo "$BASE $HEAD_SHA"
  `;
  const [base = "", head = ""] = (await $`bash -c ${script}`.cwd(cwd).text()).trim().split(" ");
  return { base, head };
}

function stub({ home, cwd }: Home, tool: string, args: string[], input?: string) {
  const proc = Bun.spawnSync([join(home, ".eval-stubs/bin", tool), ...args], {
    cwd,
    env: { ...process.env, HOME: home },
    stdin: input === undefined ? undefined : new TextEncoder().encode(input),
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

describe("install.sh", () => {
  test("refuses a working directory outside an eval workspace", () => {
    const home = mkdtempSync(join(tmpdir(), "eval-stubs-home-"));
    const proc = Bun.spawnSync(["bash", join(import.meta.dir, "install.sh")], {
      cwd: home,
      env: { ...process.env, HOME: home },
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("refusing to edit");
  });

  test("puts self-contained gh and glab first on PATH through .zshenv and .bashrc", async () => {
    const run = await install();
    const line = `export PATH="${join(run.home, ".eval-stubs/bin")}:$PATH"\n`;
    const rcs = [".zshenv", ".bashrc"].map(async (rc) => Bun.file(join(run.home, rc)).text());
    expect(await Promise.all(rcs)).toEqual([line, line]);
    expect(await Bun.file(join(run.cwd, ".eval-verdicts")).exists()).toBe(false);
    for (const tool of ["gh", "glab"]) {
      expect(Bun.spawnSync(["test", "-x", join(run.home, ".eval-stubs/bin", tool)]).exitCode).toBe(
        0,
      );
    }
  });
});

describe("preamble.sh", () => {
  test("commits at fixed dates, so SHAs repeat", async () => {
    const shas = await Promise.all(
      [0, 1].map(async () => {
        const cwd = mkdtempSync(join(tmpdir(), "eval-stubs-repo-"));
        return scaffold(cwd, "https://github.com/acme/api.git");
      }),
    );
    expect(shas[0]).toEqual(shas[1]);
    expect(shas[0]?.head).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("echo mode", () => {
  let run: Home;
  const gitlab = "https://gitlab.com/team/service/-/merge_requests/1";
  const block = (title: string, body: string, url: string) =>
    `PR-TITLE: ${title}\nPR-BODY-BEGIN\n${body}\nPR-BODY-END\n${url}\n`;

  beforeAll(async () => {
    run = await install();
    await $`git init -q && git remote add origin https://gitlab.com/team/service.git`.cwd(run.cwd);
  });

  test.each([
    ["-t and -d", ["-t", "T", "-d", "Body"]],
    ["--title and --description", ["--title", "T", "--description", "Body"]],
    ["--flag=value forms", ["--title=T", "--description=Body"]],
    ["-b", ["-t", "T", "-b", "Body"]],
    ["--body=value", ["--title=T", "--body=Body"]],
  ])("glab mr create prints the block for %s", (_, flags) => {
    const r = stub(run, "glab", ["mr", "create", "--yes", ...flags]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(block("T", "Body", gitlab));
  });

  test("reads the body from a file", async () => {
    const file = join(run.cwd, "body.md");
    await Bun.write(file, "From file\n\nSecond block\n");
    for (const flags of [
      ["-F", file],
      ["--body-file", file],
      [`--body-file=${file}`],
      ["--description-file", file],
      [`--description-file=${file}`],
    ]) {
      const r = stub(run, "glab", ["mr", "create", "-t", "T", ...flags]);
      expect(r.out).toBe(block("T", "From file\n\nSecond block", gitlab));
    }
  });

  test.each([
    ["gh", "pr"],
    ["glab", "mr"],
  ])("%s fails like gh on a body file it cannot read", (tool, noun) => {
    const r = stub(run, tool, [noun, "create", "-t", "T", "--body-file", "tmp/missing.md"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("open tmp/missing.md: no such file or directory\n");
  });

  test.each([["-F"], ["-d"], ["--description"]])("reads the body from stdin for %s -", (flag) => {
    const r = stub(run, "glab", ["mr", "create", "-t", "T", flag, "-"], "Piped\n- a\n- b\n");
    expect(r.out).toBe(block("T", "Piped\n- a\n- b", gitlab));
  });

  test("keeps a multi-line body verbatim", () => {
    const body = "Why.\n\n- one\n- two\n\n## Heading";
    expect(stub(run, "glab", ["mr", "create", "-t", "T", "-d", body]).out).toBe(
      block("T", body, gitlab),
    );
  });

  test.each([
    ["glab", ["mr", "update", "1", "--description", "Edited"], gitlab],
    ["gh", ["pr", "edit", "1", "--body", "Edited"], "https://github.com/team/service/pull/1"],
  ])("%s %j prints the edited body", (tool, args, url) => {
    expect(stub(run, tool, args).out).toBe(block("", "Edited", url));
  });

  test("gh derives the URL from an ssh origin", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "eval-stubs-repo-"));
    await $`git init -q && git remote add origin git@github.com:bendrucker/claude.git`.cwd(cwd);
    const r = stub({ ...run, cwd }, "gh", ["pr", "create", "--title", "T", "--body", "Body"]);
    expect(r.out).toBe(block("T", "Body", "https://github.com/bendrucker/claude/pull/1"));
  });

  test.each([
    ["glab", ["mr", "list"]],
    ["gh", ["pr", "view", "1"]],
    ["gh", ["api", "repos/x/y"]],
    ["gh", ["mr", "create"]],
  ])("%s %j fails offline", (tool, args) => {
    const r = stub(run, tool, args);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(`${tool} stand-in: ${args.join(" ")} is unavailable offline\n`);
  });
});

describe("--check", () => {
  const github = "https://github.com/team/service/pull/1";

  async function installIn(args: string[]): Promise<Home> {
    const run = await install(args);
    await $`git init -q && git remote add origin https://github.com/team/service.git`.cwd(run.cwd);
    return run;
  }

  const verdicts = (run: Home) => Bun.file(join(run.cwd, ".eval-verdicts")).text();

  test("echo mode prints the verdicts after the URL and records them", async () => {
    const run = await installIn(["--check", "check.ts"]);
    expect(await verdicts(run)).toBe("");
    const r = stub(run, "gh", ["pr", "create", "--title", "T", "--body", "one two three"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      `PR-TITLE: T\nPR-BODY-BEGIN\none two three\nPR-BODY-END\n${github}\nWORDS pass\n`,
    );
    expect(await verdicts(run)).toBe("WORDS pass\n");
  });

  test("--offline prints only the verdicts, then fails", async () => {
    const run = await installIn(["--offline", "--check", "check.ts"]);
    const r = stub(run, "gh", ["pr", "edit", "1", "--body", "one two three four"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("WORDS fail\n");
    expect(r.err).toBe("gh stand-in: pr edit is unavailable offline\n");
    expect(await verdicts(run)).toBe("WORDS fail\n");
  });

  test("a later counted call replaces the recorded verdicts", async () => {
    const run = await installIn(["--offline", "--check", "check.ts"]);
    stub(run, "gh", ["pr", "create", "-t", "T", "--body", "one two three four"]);
    stub(run, "gh", ["pr", "edit", "1", "--body", "one two three"]);
    expect(await verdicts(run)).toBe("WORDS pass\n");
  });

  test.each([
    ["a body under three words", ["--body", "x"]],
    ["an empty body", ["--body", ""]],
    ["--dry-run", ["--dry-run", "--body", "one two three four"]],
  ])("%s neither prints nor records verdicts", async (_, flags) => {
    const run = await installIn(["--offline", "--check", "check.ts"]);
    stub(run, "gh", ["pr", "create", "-t", "T", "--body", "one two three"]);
    const r = stub(run, "gh", ["pr", "create", "-t", "T", ...flags]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(await verdicts(run)).toBe("WORDS pass\n");
  });
});

describe("gh snapshot", () => {
  let run: Home;
  let shas: { base: string; head: string };

  beforeAll(async () => {
    run = await install();
    shas = await scaffold(run.cwd, "https://github.com/acme/api.git");
    const comment = (author: string, body: string) => ({
      author,
      body,
      createdAt: "2026-09-02T12:00:00Z",
      commit: shas.head,
    });
    await Bun.write(
      join(run.home, ".eval-stubs/meta.json"),
      JSON.stringify({
        root: run.cwd,
        repo: "acme/api",
        viewer: "bendrucker",
        base: shas.base,
        head: shas.head,
        pull: {
          number: 7,
          title: "Add b",
          body: "Adds b.",
          author: "dana-k",
          headRefName: "feature",
          createdAt: "2026-09-02T10:05:00Z",
        },
        reviews: [
          {
            id: 1,
            author: "mchen",
            state: "CHANGES_REQUESTED",
            submittedAt: "1",
            commit: shas.head,
          },
          { id: 2, author: "mchen", state: "COMMENTED", submittedAt: "2", commit: shas.head },
          { id: 3, author: "bot", bot: true, state: "COMMENTED", submittedAt: "3", commit: "x" },
        ],
        threads: [
          {
            id: "T1",
            isResolved: true,
            resolvedBy: "dana-k",
            path: "a.txt",
            line: 2,
            comments: [comment("mchen", "Why two?"), comment("dana-k", "Fixed.")],
          },
          { id: "T2", isResolved: false, path: "b.txt", line: 1, comments: [comment("x", "Hm")] },
        ],
      }),
    );
  });

  test("serves the pull request from the repo's commits", () => {
    const r = stub(run, "gh", ["pr", "view", "7", "--json", "headRefOid,commits,reviewDecision"]);
    expect(JSON.parse(r.out)).toMatchObject({
      headRefOid: shas.head,
      commits: [{ messageHeadline: "app: second line" }, { messageHeadline: "app: add b" }],
      reviewDecision: "CHANGES_REQUESTED",
    });
  });

  test("a later comment keeps a change request in latestReviews", () => {
    const r = stub(run, "gh", [
      "pr",
      "view",
      "--json",
      "latestReviews",
      "-q",
      ".latestReviews[].state",
    ]);
    expect(r.out).toBe("CHANGES_REQUESTED\nCOMMENTED\n");
  });

  test("answers the GraphQL review-thread query with resolution state", () => {
    const r = stub(run, "gh", [
      "api",
      "graphql",
      "-f",
      "query=query { repository { pullRequest { reviewThreads { nodes { id } } } } }",
      "-f",
      "owner=acme",
      "-f",
      "repo=api",
      "--jq",
      ".data.repository.pullRequest.reviewThreads.nodes[] | [.id, .isResolved, .resolvedBy.login] | @tsv",
    ]);
    expect(r.out).toBe("T1\ttrue\tdana-k\nT2\tfalse\t\n");
  });

  test("reports another repository as not found", () => {
    const r = stub(run, "gh", [
      "api",
      "graphql",
      "-f",
      "query=query { x }",
      "-f",
      "owner=a",
      "-f",
      "repo=b",
    ]);
    expect(JSON.parse(r.out)).toMatchObject({ data: { repository: null } });
  });

  test("fills {owner}/{repo} in REST paths and diffs the pull request", () => {
    const comments = stub(run, "gh", [
      "api",
      "repos/{owner}/{repo}/pulls/7/comments",
      "--jq",
      ".[].in_reply_to_id",
    ]);
    expect(comments.out).toBe("null\n1000000\nnull\n");
    const files = stub(run, "gh", ["pr", "diff", "7", "--name-only"]);
    expect(files.out).toBe("a.txt\nb.txt\n");
  });

  test("reports checks only when the snapshot lists them", () => {
    expect(stub(run, "gh", ["pr", "checks", "7"]).out).toBe("no checks reported on the branch\n");
  });

  test.each([
    [["pr", "comment", "7", "--body", "hi"], "gh pr comment"],
    [["api", "-X", "POST", "repos/acme/api/pulls/7/comments", "-f", "body=x"], "POST"],
    [["api", "repos/acme/api/pulls/7/comments", "-f", "body=x"], "POST"],
    [["api", "graphql", "-f", "query=mutation { resolve }"], "a GraphQL mutation"],
  ])("refuses the write %j", (args, what) => {
    const r = stub(run, "gh", args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(what);
    expect(r.err).toContain("is disabled");
  });
});

describe("glab snapshot", () => {
  let run: Home;
  let shas: { base: string; head: string };
  const note = (id: number, username: string, body: string, extra = {}) => ({
    id,
    type: "DiscussionNote",
    body,
    author: { id, username, name: username },
    created_at: `2026-09-0${id}T00:00:00Z`,
    system: false,
    ...extra,
  });

  beforeAll(async () => {
    run = await install();
    shas = await scaffold(run.cwd, "https://gitlab.example.com/team/service.git");
    await Bun.write(
      join(run.home, ".eval-stubs/meta.json"),
      JSON.stringify({
        root: run.cwd,
        host: "gitlab.example.com",
        project: "team/service",
        projectId: 12,
        viewer: { id: 1, username: "bendrucker", name: "Ben Drucker" },
        mr: {
          iid: 89,
          title: "Add b",
          description: "Adds b.",
          author: { username: "dana-k", name: "Dana Kim" },
          reviewers: [{ id: 2, username: "jlee", name: "Jamie Lee" }],
          source_branch: "feature",
          created_at: "2026-09-02T10:05:00Z",
          updated_at: "2026-09-03T10:05:00Z",
        },
        versions: [
          { id: 301, head: shas.head, base: shas.base, start: shas.base, created_at: "x" },
        ],
        discussions: [
          { id: "d1", notes: [note(3, "jlee", "Why b?", { resolvable: true, resolved: false })] },
          { id: "d2", notes: [note(4, "dana-k", "added 1 commit", { system: true })] },
        ],
      }),
    );
  });

  test("serves the discussions as written", () => {
    const args = [
      "api",
      "projects/:id/merge_requests/89/discussions",
      "--paginate",
      "--jq",
      ".[].id",
    ];
    expect(stub(run, "glab", args).out).toBe("d1\nd2\n");
  });

  test("derives the merge state and note count from the discussions", () => {
    expect(
      JSON.parse(stub(run, "glab", ["mr", "view", "89", "--output", "json"]).out),
    ).toMatchObject({
      author: { id: 42, username: "dana-k" },
      sha: shas.head,
      detailed_merge_status: "discussions_not_resolved",
      user_notes_count: 1,
    });
  });

  test("prints notes oldest first under --comments and newest first for note list", () => {
    const view = stub(run, "glab", ["mr", "view", "89", "-c"]).out;
    expect(view).toContain("reviewers:\tjlee\n");
    expect(view.indexOf("Why b?")).toBeLessThan(view.indexOf("added 1 commit"));
    const list = stub(run, "glab", ["mr", "note", "list", "89"]).out;
    expect(list.indexOf("added 1 commit")).toBeLessThan(list.indexOf("Why b?"));
  });

  test("lists participants once each", () => {
    const path = "projects/team%2Fservice/merge_requests/89/participants";
    const r = stub(run, "glab", ["api", path, "--jq", ".[].username"]);
    expect(r.out).toBe("dana-k\nbendrucker\njlee\n");
  });

  test("serves version diffs from the repo", () => {
    const r = stub(run, "glab", ["api", "projects/12/merge_requests/89/versions/301"]);
    expect(JSON.parse(r.out)).toMatchObject({
      commits: [{ title: "app: add b" }, { title: "app: second line" }],
      diffs: [{ new_path: "a.txt" }, { new_path: "b.txt", new_file: true }],
    });
  });

  test.each([
    [["mr", "note", "89", "-m", "hi"], "glab mr note"],
    [["mr", "approve", "89"], "glab mr approve"],
    [
      ["api", "-X", "PUT", "projects/:id/merge_requests/89/discussions/d1", "-f", "resolved=true"],
      "PUT",
    ],
    [["api", "graphql", "-f", "query=mutation { x }"], "a GraphQL mutation"],
  ])("refuses the write %j", (args, what) => {
    const r = stub(run, "glab", args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(what);
  });
});
