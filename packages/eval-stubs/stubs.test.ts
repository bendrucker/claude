import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const SOURCES = [
  "calls.ts",
  "claude.ts",
  "echo.ts",
  "gh.ts",
  "glab.ts",
  "rex.ts",
  "snapshot.ts",
  "wt.ts",
  "install.sh",
  "preamble.sh",
];

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

  test("puts self-contained stand-ins first on PATH through .zshenv and .bashrc", async () => {
    const run = await install();
    const line = `export PATH="${join(run.home, ".eval-stubs/bin")}:$PATH"\n`;
    const rcs = [".zshenv", ".bashrc"].map(async (rc) => Bun.file(join(run.home, rc)).text());
    expect(await Promise.all(rcs)).toEqual([line, line]);
    expect(await Bun.file(join(run.cwd, ".eval-verdicts")).exists()).toBe(false);
    for (const tool of ["gh", "glab", "rex", "wt", "claude"]) {
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

  test("glab accepts --attach on mr update and mr note create, echoing the body", () => {
    expect(
      stub(run, "glab", ["mr", "update", "1", "--attach", "tmp/s.png", "-d", "Edited"]).out,
    ).toBe(block("", "Edited", gitlab));
    expect(
      stub(run, "glab", ["mr", "note", "create", "1", "--attach", "tmp/s.png", "-m", "Edited"]).out,
    ).toBe(block("", "Edited", gitlab));
  });

  test.each([
    ["glab", ["mr", "update", "1", "--description", "Edited"], gitlab],
    ["gh", ["pr", "edit", "1", "--body", "Edited"], "https://github.com/team/service/pull/1"],
    ["glab", ["mr", "note", "1", "-m", "Edited"], gitlab],
    ["glab", ["issue", "note", "1", "--message=Edited"], gitlab],
  ])("%s %j prints the edited body", (tool, args, url) => {
    expect(stub(run, tool, args).out).toBe(block("", "Edited", url));
  });

  test("glab api note posts read -F body=@<path> and send -f body=@<path> literally", async () => {
    const file = join(run.cwd, "note.md");
    await Bun.write(file, "From file\n");
    const post = (...flags: string[]) =>
      stub(run, "glab", ["api", "projects/:id/merge_requests/1/notes", "-X", "POST", ...flags]).out;
    expect(post("-F", `body=@${file}`)).toBe(block("", "From file", gitlab));
    expect(post(`--field=body=@${file}`)).toBe(block("", "From file", gitlab));
    expect(post("-f", `body=@${file}`)).toBe(block("", `@${file}`, gitlab));
    expect(post("--raw-field", "body=Inline")).toBe(block("", "Inline", gitlab));
    const json = join(run.cwd, "payload.json");
    await Bun.write(json, JSON.stringify({ body: "From JSON" }));
    expect(post("--input", json)).toBe(block("", "From JSON", gitlab));
  });

  test("gh derives the URL from an ssh origin", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "eval-stubs-repo-"));
    await $`git init -q && git remote add origin git@github.com:bendrucker/claude.git`.cwd(cwd);
    const r = stub({ ...run, cwd }, "gh", ["pr", "create", "--title", "T", "--body", "Body"]);
    expect(r.out).toBe(block("T", "Body", "https://github.com/bendrucker/claude/pull/1"));
  });

  test.each([
    ["glab", ["mr", "list"]],
    ["glab", ["api", "projects/:id/merge_requests/1"]],
    ["glab", ["api", "projects/:id/merge_requests/1/discussions", "--paginate"]],
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
            body: "Needs a test.",
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

  test("plain view lists each reviewer's standing state", () => {
    const lines = stub(run, "gh", ["pr", "view", "7"]).out.split("\n");
    expect(lines).toContain("reviewers:\tmchen (Changes requested), bot (Commented)");
    expect(lines.slice(-3)).toEqual(["--", "Adds b.", ""]);
  });

  test("plain view with --comments prints review bodies, not the header", () => {
    const r = stub(run, "gh", ["pr", "view", "7", "--comments"]);
    expect(r.out).toBe(
      "author:\tmchen\nassociation:\tmember\nedited:\tfalse\nstatus:\tchanges requested\n--\nNeeds a test.\n--\n",
    );
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

  test("prints one item per line for --paginate --output ndjson", () => {
    const r = stub(run, "glab", [
      "api",
      "--paginate",
      "--output",
      "ndjson",
      "projects/:id/merge_requests/89/discussions?per_page=100",
    ]);
    const lines = r.out.trimEnd().split("\n");
    expect(lines.map((l) => /"id":"([^"]+)"/.exec(l)?.[1])).toEqual(["d1", "d2"]);
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

  test("expands --placeholder into one encoded path segment before matching", async () => {
    await $`git branch release/rate-limit`.cwd(run.cwd);
    const get = (...args: string[]) => stub(run, "glab", ["api", ...args]);
    const encoded = get(
      "projects/:id/repository/branches/:b",
      "--placeholder",
      "b=release/rate-limit",
    );
    expect(JSON.parse(encoded.out)).toMatchObject({
      name: "release/rate-limit",
      commit: { id: shas.head },
    });
    expect(get("projects/:id/repository/branches/release%2Frate-limit").code).toBe(0);
    const raw = get("projects/:id/repository/branches/release/rate-limit");
    expect(raw.code).toBe(1);
    expect(raw.err).toContain("404");
    expect(get("projects/:id/repository/branches/:b", "--placeholder", "b=nope").err).toContain(
      "404",
    );
  });

  test("keeps :b distinct from a longer placeholder name", () => {
    const r = stub(run, "glab", [
      "api",
      "projects/:id/repository/branches/:branch",
      "--placeholder",
      "b=x",
      "--placeholder",
      "branch=release/rate-limit",
    ]);
    expect(JSON.parse(r.out)).toMatchObject({ name: "release/rate-limit" });
  });

  test.each([
    [["mr", "note", "89", "-m", "hi"], "glab mr note"],
    [["mr", "note", "create", "89", "--reply", "d1"], "glab mr note create"],
    [["mr", "note", "create", "89", "-m", "/request_review @jlee"], "glab mr note create"],
    [
      ["mr", "note", "create", "89", "--attach", "tmp/shot.png", "-m", "see"],
      "glab mr note create",
    ],
    [["mr", "note", "resolve", "89", "d1"], "glab mr note resolve"],
    [["mr", "note", "reopen", "89", "d1"], "glab mr note reopen"],
    [["mr", "update", "89", "--attach", "tmp/shot.png"], "glab mr update"],
    [["mr", "update", "--attach", "tmp/a.png", "--attach", "tmp/b.png", "89"], "glab mr update"],
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

describe("dispatch stand-ins", () => {
  const calls = async (run: Home) =>
    (await Bun.file(join(run.cwd, ".eval-calls")).text()).trim().split("\n");
  const line = (cli: string, argv: string[]) => [cli, ...argv].join(" ");

  test.each([
    [["whoami", "--json"], '{"tailscale":null}\n'],
    [["window", "new", "-s", "session:eval", "eval-x"], '{"block_ids":["block:eval-1"]}\n'],
    [["split", "-b", "block:sender", "--split=right"], '{"block_ids":["block:eval-2"]}\n'],
    [
      ["block", "call", "-b", "block:eval-1", "program_status", "{}"],
      '{"records":[{"state":"working","effective_app":"claude-code"}]}\n',
    ],
    [["capture", "-b", "block:eval-1", "--trim"], ""],
    [["ls"], '[{"name":"local","address":"local","state":"connected"}]\n'],
    [["hosts", "list"], '[{"name":"local","address":"local","state":"connected"}]\n'],
  ])("rex %j", async (args, out) => {
    // Each case shares one run so the block counter advances across them.
    run ??= await install();
    const r = stub(run, "rex", args);
    expect(r.code).toBe(0);
    expect(r.out).toBe(out);
    expect((await calls(run)).at(-1)).toBe(line("rex", args));
  });

  let run: Home | undefined;

  test("rex reports the state in session-status, bare or as JSON", async () => {
    const r = await install();
    const poll = () =>
      stub(r, "rex", ["block", "call", "-b", "b", "program_status", "{}"]).out.trim();
    await Bun.write(join(r.home, ".eval-stubs/session-status"), "done\n");
    expect(poll()).toBe('{"records":[{"state":"done","effective_app":"claude-code"}]}');
    await Bun.write(
      join(r.home, ".eval-stubs/session-status"),
      '{"state":"blocked","kind":"permission","msg":"Bash"}',
    );
    expect(poll()).toBe(
      '{"records":[{"state":"blocked","kind":"permission","msg":"Bash","effective_app":"claude-code"}]}',
    );
  });

  test("install.sh starts an empty call log", async () => {
    const r = await install();
    expect(await Bun.file(join(r.cwd, ".eval-calls")).text()).toBe("");
    expect(await Bun.file(join(r.cwd, ".eval-briefs.md")).text()).toBe("");
  });

  test("a launch logs its command without the prompt, which goes to the briefs file", async () => {
    const r = await install();
    const worktree = join(r.home, "wt1");
    mkdirSync(join(worktree, ".claude"), { recursive: true });
    await Bun.write(
      join(worktree, ".claude/settings.local.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(bun test:*)", "Read"] },
        sandbox: { filesystem: { allowWrite: ["/x/repo"] } },
      }),
    );
    const launch = (path: string, name: string, prompt: string) =>
      stub(r, "rex", [
        "window",
        "new",
        "-s",
        "s",
        name,
        "-c",
        path,
        "--json",
        "--",
        "claude",
        "--name",
        name,
        "--",
        prompt,
      ]);
    launch(worktree, "one", "Fix it.\nThen test.");
    launch(join(r.home, "none"), "two", "Other");
    stub(r, "claude", ["--bg", "--name", "bg", "--", "Back\nground"]);
    expect(await calls(r)).toEqual([
      `rex window new -s s one -c ${worktree} --json -- claude --name one -- <prompt>`,
      `launch one ${worktree}`,
      "allow Bash(bun test:*)",
      "allow Read",
      "sandbox-write /x/repo",
      `rex window new -s s two -c ${join(r.home, "none")} --json -- claude --name two -- <prompt>`,
      `launch two ${join(r.home, "none")}`,
      "claude --bg --name bg -- <prompt>",
    ]);
    expect(await Bun.file(join(r.cwd, ".eval-briefs.md")).text()).toBe(
      "=== prompt for one ===\nFix it.\nThen test.\n\n=== prompt for two ===\nOther\n\n=== prompt for bg ===\nBack\nground\n\n",
    );
  });

  test("newlines inside an argument word stay on one line", async () => {
    const r = await install();
    stub(r, "rex", ["kill", "a\nb"]);
    expect(await calls(r)).toEqual(["rex kill a b"]);
  });

  test("rex fails anything else offline, and records the call", async () => {
    const r = await install();
    const res = stub(r, "rex", ["kill", "-b", "x"]);
    expect(res.code).toBe(1);
    expect(res.out).toBe("");
    expect(res.err).toBe("rex stand-in: kill -b x is unavailable offline\n");
    expect(await calls(r)).toEqual([line("rex", ["kill", "-b", "x"])]);
  });

  test("claude records the call and fails offline", async () => {
    const r = await install();
    const res = stub(r, "claude", ["--bg", "--name", "n", "go"]);
    expect(res.code).toBe(1);
    expect(res.out).toBe("");
    expect(res.err).toBe("claude stand-in: --bg --name n go is unavailable offline\n");
    expect(await calls(r)).toEqual([line("claude", ["--bg", "--name", "n", "go"])]);
  });

  describe("wt", () => {
    let r: Home;
    let root: string;
    const switchArgs = (...target: string[]) => [
      "-C",
      root,
      "switch",
      ...target,
      "--no-cd",
      "--yes",
      "--format=json",
    ];

    beforeAll(async () => {
      r = await install();
      root = join(r.home, "repo");
      mkdirSync(root);
      await $`git init -q -b main && git config user.email a@b.c && git config user.name n && git commit -q --allow-empty -m init && git branch old`.cwd(
        root,
      );
    });

    test("creates a branch under .worktrees, then reports it existing", async () => {
      const args = switchArgs("--create", "feat/x", "--base", "main");
      const first = stub(r, "wt", args);
      const path = join(root, ".worktrees/feat/x");
      expect(first.code).toBe(0);
      expect(first.out).toBe(
        `${JSON.stringify({ action: "created", branch: "feat/x", path, created_branch: true })}
`,
      );
      expect((await $`git -C ${path} branch --show-current`.text()).trim()).toBe("feat/x");
      const second = stub(r, "wt", switchArgs("feat/x"));
      expect(second.out).toBe(
        `${JSON.stringify({ action: "existing", branch: "feat/x", path, created_branch: false })}
`,
      );
      expect((await calls(r)).at(0)).toBe(line("wt", args));
    });

    test("checks out an existing branch without creating it", () => {
      const path = join(root, ".worktrees/old");
      expect(stub(r, "wt", switchArgs("old")).out).toBe(
        `${JSON.stringify({ action: "created", branch: "old", path, created_branch: false })}
`,
      );
    });

    test.each([["pr:12"], ["mr:3"]])("%s fails offline and is recorded", async (target) => {
      const args = switchArgs(target);
      const res = stub(r, "wt", args);
      expect(res.code).toBe(1);
      expect(res.err).toBe(`wt stand-in: ${args.join(" ")} is unavailable offline\n`);
      expect((await calls(r)).at(-1)).toBe(line("wt", args));
    });

    test("other subcommands fail offline", () => {
      const res = stub(r, "wt", ["list"]);
      expect(res.code).toBe(1);
      expect(res.err).toBe("wt stand-in: list is unavailable offline\n");
    });
  });

  test("dispatch.ts runs end to end against the stand-ins", async () => {
    const r = await install();
    const repo = join(r.home, "repo");
    mkdirSync(repo);
    const origin = join(r.home, "origin.git");
    await $`git init -q --bare -b main ${origin}`;
    await $`git init -q -b main && git config user.email a@b.c && git config user.name n && git remote add origin ${origin} && git commit -q --allow-empty -m init && git push -q -u origin main`.cwd(
      repo,
    );
    const prompt = join(r.home, "prompt.md");
    await Bun.write(prompt, "Do the thing.\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("HERDR_")),
    );
    const proc = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "../../plugins/dispatch/skills/dispatch/scripts/dispatch.ts"),
        "--branch",
        "eval-x",
        "--prompt",
        prompt,
      ],
      {
        cwd: repo,
        env: {
          ...env,
          HOME: r.home,
          PATH: `${join(r.home, ".eval-stubs/bin")}:${process.env.PATH ?? ""}`,
          REX_BLOCK: "block:sender",
          REX_SESSION: "session:eval",
          CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), "eval-stubs-data-")),
        },
      },
    );
    expect(proc.stderr.toString()).toBe("");
    const printed = proc.stdout.toString().trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(printed)).toMatchObject({ status: "working", branch: "eval-x" });
    expect(Bun.spawnSync(["test", "-d", join(repo, ".worktrees/eval-x")]).exitCode).toBe(0);
    expect(await Bun.file(join(r.cwd, ".eval-briefs.md")).text()).toContain("Do the thing.");
    expect(await calls(r)).toContain(`launch eval-x ${join(repo, ".worktrees/eval-x")}`);
    expect((await calls(r)).some((l) => l.startsWith("wt "))).toBe(true);
  });
});
