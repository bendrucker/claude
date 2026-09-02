import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import {
  commitDirectories,
  formatDenyOutput,
  invokesGitCommit,
  processInput,
} from "./block-default-branch-commit";

function mockInput(command: string, cwd: string): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "test",
    transcript_path: "/tmp/test",
    cwd,
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "test",
  };
}

async function getOutput(input: PreToolUseHookInput): Promise<PreToolUseHookSpecificOutput | null> {
  const specific = (await processInput(input))?.hookSpecificOutput;
  return specific?.hookEventName === "PreToolUse" ? specific : null;
}

describe("invokesGitCommit", () => {
  test.each<[string, boolean]>([
    ["git commit", true],
    ['git commit -m "test"', true],
    ["git -C /repo commit -m x", true],
    ["git -c user.name=x commit", true],
    ["git --no-pager commit --amend", true],
    ["git -C /repo -c commit.gpgsign=false commit", true],
    ["git add . && git commit -m x", true],
    ["git status | tee log && git commit", true],
    ["echo hi > $TMPDIR/probe.txt", false],
    ["{ echo one; echo two; }", false],
    ["for f in *.ts; do wc -l $f; done", false],
    ["cat <<'EOF' > notes.md\nnothing here\nEOF", false],
    ["git log --oneline | head -20 | awk '{print $1}' | sort | uniq", false],
    ["git log --grep commit", false],
    ["git commit-tree $tree", false],
    ["echo 'run git commit next'", false],
    ['gh pr create --body "then git commit"', false],
    ["cat > notes.md <<'EOF'\nthen run git commit -m done\nEOF", false],
    ["cat > notes.md <<EOF\nthen run git commit -m done\nEOF", false],
    ["cat > notes.md <<-\\EOF\n\tgit commit here\n\tEOF", false],
    ["cat > notes.md <<'EOF'\nit's a git commit\nEOF", false],
    ["cat > notes.md <<'EOF'\nunterminated git commit", false],
    ["cat > notes.md <<'EOF'\nnotes\nEOF\ngit commit -m x", true],
    ["cat > a <<'ONE' > b <<'TWO'\nfirst\nONE\ngit commit\nTWO", false],
    ["grep '<<EOF' f && git commit", true],
    ["git commit -F - <<'EOF'\nmessage\nEOF", true],
    ["cat > f <<'MY-DELIM'\nnotes\nMY-DELIM\ngit commit", true],
    ["cat > f <<MY-DELIM\nnotes\nMY-DELIM\ngit commit", true],
    ["cat > f <<123\ngit commit here\n123", false],
    ["cat <<EOF>f\ngit commit here\nEOF", false],
    ["# <<EOF\ngit commit -m x", true],
    ["cat > f <<'EOF' # notes\ngit commit here\nEOF", false],
    ["# git commit", false],
    ["true;# <<EOF\ngit commit -m x", true],
    ["echo a && # <<EOF\ngit commit -m x", true],
    ["echo \\<< /dev/null\ngit commit -m x", true],
    ["echo a#b && git commit", true],
    ['echo "# <<EOF" && git commit', true],
    ["cat > f <<E'OF'\ngit commit here\nEOF", false],
    ["cat > f <<E'OF'\nnotes\nEOF\ngit commit", true],
    ['cat > f <<"EOF"\ngit commit here\nEOF', false],
    ["cat > f <<E\\OF\ngit commit here\nEOF", false],
    ["echo $((1<<2))\ngit commit -m x", true],
    ["echo $(( (1<<2) ))\ngit commit -m x", true],
    ["(( 1 << 2 ))\ngit commit -m x", true],
    ["(( x <<= 2 )); git commit -m x", true],
  ])("%p → %p", (command, expected) => {
    expect(invokesGitCommit(command)).toBe(expected);
  });
});

describe("commitDirectories", () => {
  test.each<[string, string[]]>([
    ["git commit -m x", ["/repo"]],
    ["cd /wt && git commit -m x", ["/wt"]],
    ["cd /wt; git commit -m x", ["/wt"]],
    ["cd /wt\ngit commit -m x", ["/wt"]],
    ["cd sub && git commit -m x", ["/repo/sub"]],
    ["cd /a && cd b && cd ../c && git commit", ["/a/c"]],
    ['cd "/with space" && git commit', ["/with space"]],
    ["cd '/wt' && git commit", ["/wt"]],
    ["cd ~/wt && git commit", [join(homedir(), "wt")]],
    ["cd ~ && git commit", [homedir()]],
    ["git commit -m x && cd /elsewhere", ["/repo"]],
    ["cd /a || cd /b && git commit", ["/a"]],
    ["cd $WT && git commit", ["/repo"]],
    ["cd $(pwd)/wt && git commit", ["/repo"]],
    ["cd - && git commit", ["/repo"]],
    ["cd ~user/wt && git commit", ["/repo"]],
    ["cd /a && cd $WT && git commit", ["/repo"]],
    ["cat > f <<'EOF'\ncd /inside\nEOF\ngit commit", ["/repo"]],
    ["echo 'cd /quoted' && git commit", ["/repo"]],
    ["cd /wt && git commit -m 'cd /msg'", ["/wt"]],
    ["(cd /wt && git commit)", ["/wt"]],
    ["echo $(cd /x && pwd) && git commit", ["/repo"]],
    ["cd /wt | git commit", ["/repo"]],
    ["cd /wt & git commit", ["/repo"]],
    ['echo "done; cd /x" && git commit', ["/repo"]],
    ["cd /wt &&git commit", ["/wt"]],
    ["(cd /wt); git commit", ["/repo"]],
    ["(cd /wt && git commit); git commit", ["/wt", "/repo"]],
    ["(true && cd /wt && git commit); git commit", ["/wt", "/repo"]],
    ["cd /a && (cd /b && git commit); git commit", ["/b", "/a"]],
    ["cd /wt && (git commit) && git commit", ["/wt", "/wt"]],
    ['cd "~/wt" && git commit', ["/repo/~/wt"]],
    ["echo $(cd /wt && git commit)", ["/wt"]],
    ["echo `cd /wt && git commit`", ["/wt"]],
    ["echo `cd /x && pwd` && git commit", ["/repo"]],
    ["echo `cd /wt && echo \\`x\\` && git commit`", ["/wt"]],
    ["echo `cd /wt && echo $(x) && git commit`", ["/wt"]],
    ["cd /wt && echo `pwd` && git commit", ["/wt"]],
  ])("%p → %p", (command, expected) => {
    expect(commitDirectories(command, "/repo", (path) => [path])).toEqual(expected);
  });

  test("a cd that fails keeps the directory reached so far", () => {
    const expand = (path: string) => (path === "/wt" ? [path] : []);
    expect(commitDirectories("cd /wt && cd /gone; git commit", "/repo", expand)).toEqual(["/wt"]);
  });

  test.each<[string, Record<string, string[]>, string]>([
    ["cd /w* && git commit", { "/w*": ["/wt"] }, "/wt"],
    ["cd /w* && git commit", { "/w*": ["/wt", "/www"] }, "/repo"],
    ["cd /w* && git commit", { "/w*": [] }, "/repo"],
    ["cd '/w*' && git commit", { "/w*": ["/wt"] }, "/repo"],
  ])("%p with %j → %p", (command, matches, expected) => {
    const expand = (path: string, quoted: boolean) => (quoted ? [] : (matches[path] ?? []));
    expect(commitDirectories(command, "/repo", expand)).toEqual([expected]);
  });
});

describe("formatDenyOutput", () => {
  it("formats deny output with branch name", () => {
    const output = formatDenyOutput("main");
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Cannot commit directly to main. Create a topic branch first with: git checkout -b <branch-name>",
      },
    });
  });
});

async function createTestRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "git-hook-test-"));

  await $`git init -q -b main`.cwd(repo).quiet();
  await $`git config user.email test@example.com`.cwd(repo).quiet();
  await $`git config user.name "Test User"`.cwd(repo).quiet();
  await Bun.write(join(repo, "README.md"), "");
  await $`git add README.md`.cwd(repo).quiet();
  await $`git commit -q -m initial`.cwd(repo).quiet();
  await $`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.cwd(repo).quiet();

  return repo;
}

describe("processInput", () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it("allows commit on feature branch", async () => {
    await $`git checkout -q -b feature-branch`.cwd(testRepo).quiet();
    const output = await processInput(mockInput('git commit -m "test"', testRepo));
    expect(output).toBeNull();
  });

  test.each<[string]>([['git commit -m "test"'], ['git commit -a -m "test"']])(
    "blocks %p on main branch",
    async (command) => {
      const output = await getOutput(mockInput(command, testRepo));
      expect(output?.permissionDecision).toBe("deny");
    },
  );

  // The matcher fails open on shell metacharacters, so these reach the hook on
  // the default branch even though none of them commits.
  test.each<[string]>([
    ["echo hi > $TMPDIR/probe.txt"],
    ["{ echo one; echo two; }"],
    ["for f in *.ts; do wc -l $f; done"],
    ["cat <<'EOF' > notes.md\nnothing here\nEOF"],
    ["git log --oneline | head -20 | awk '{print $1}' | sort | uniq"],
  ])("allows %p on main branch", async (command) => {
    const output = await processInput(mockInput(command, testRepo));
    expect(output).toBeNull();
  });

  describe("with a worktree on a topic branch", () => {
    let worktree: string;

    beforeEach(async () => {
      worktree = await mkdtemp(join(tmpdir(), "git-hook-worktree-"));
      await $`git worktree add -q -b topic ${worktree}`.cwd(testRepo).quiet();
    });

    afterEach(async () => {
      await rm(worktree, { recursive: true, force: true });
    });

    type Case = (repo: string, worktree: string) => { command: string; cwd: string };
    test.each<[string, Case, "allow" | "deny"]>([
      [
        "cd into the worktree from main",
        (repo, wt) => ({ command: `cd ${wt} && git commit -m x`, cwd: repo }),
        "allow",
      ],
      [
        "cd into the main checkout from the worktree",
        (repo, wt) => ({ command: `cd ${repo} && git commit -m x`, cwd: wt }),
        "deny",
      ],
      [
        "cd chain through a relative path",
        (repo, wt) => ({
          command: `cd ${dirname(wt)}; cd ${basename(wt)} && git commit -m x`,
          cwd: repo,
        }),
        "allow",
      ],
      [
        "cd into a quoted path",
        (repo, wt) => ({ command: `cd "${wt}" && git commit -m x`, cwd: repo }),
        "allow",
      ],
      [
        "cd to a file falls back to the input directory",
        (repo) => ({ command: `cd ${repo}/README.md && git commit -m x`, cwd: repo }),
        "deny",
      ],
      [
        "cd to a missing path falls back to the input directory",
        (repo, wt) => ({ command: `cd ${wt}/missing && git commit -m x`, cwd: repo }),
        "deny",
      ],
      [
        "failed cd after a cd into the main checkout",
        (repo, wt) => ({ command: `cd ${repo} && cd ${repo}/gone; git commit -m x`, cwd: wt }),
        "deny",
      ],
      [
        "commit inside a substitution that cd'd into the main checkout",
        (repo, wt) => ({ command: `echo $(cd ${repo} && git commit -m x)`, cwd: wt }),
        "deny",
      ],
      [
        "glob naming the main checkout",
        (repo, wt) => ({ command: `cd ${repo}* && git commit -m x`, cwd: wt }),
        "deny",
      ],
      [
        "glob naming the worktree",
        (repo, wt) => ({ command: `cd ${wt}* && git commit -m x`, cwd: repo }),
        "allow",
      ],
      [
        "quoted tilde is a literal path",
        (repo) => ({ command: 'cd "~/gone" && git commit -m x', cwd: repo }),
        "deny",
      ],
      [
        "second commit after the subshell closes",
        (repo, wt) => ({ command: `(cd ${wt} && git commit -m x); git commit -m y`, cwd: repo }),
        "deny",
      ],
      [
        "cd after the commit does not move it",
        (repo, wt) => ({ command: `git commit -m x && cd ${wt}`, cwd: repo }),
        "deny",
      ],
      [
        "heredoc body mentioning a commit",
        (repo) => ({
          command: "cat > notes.md <<'EOF'\nthen run git commit -m done\nEOF",
          cwd: repo,
        }),
        "allow",
      ],
      [
        "heredoc body ahead of a real commit",
        (repo) => ({ command: "cat > notes.md <<'EOF'\nnotes\nEOF\ngit commit -m x", cwd: repo }),
        "deny",
      ],
      ["plain commit on main", (repo) => ({ command: 'git commit -m "x"', cwd: repo }), "deny"],
      [
        "quoted mention of a commit",
        (repo) => ({ command: "echo 'run git commit next'", cwd: repo }),
        "allow",
      ],
      [
        "commit message naming a cd",
        (repo, wt) => ({ command: `cd ${wt} && git commit -m 'cd ${repo}'`, cwd: repo }),
        "allow",
      ],
    ])("%s", async (_name, build, expected) => {
      const { command, cwd } = build(testRepo, worktree);
      const output = await getOutput(mockInput(command, cwd));
      expect(output?.permissionDecision ?? "allow").toBe(expected);
    });

    it("stays put when a glob names the worktree and a file", async () => {
      const sibling = `${worktree}.txt`;
      await Bun.write(sibling, "");
      try {
        const output = await getOutput(mockInput(`cd ${worktree}* && git commit -m x`, testRepo));
        expect(output?.permissionDecision).toBe("deny");
      } finally {
        await rm(sibling, { force: true });
      }
    });
  });

  it("allows commit in detached HEAD state", async () => {
    await $`git checkout -q --detach HEAD`.cwd(testRepo).quiet();
    const output = await processInput(mockInput('git commit -m "test"', testRepo));
    expect(output).toBeNull();
  });

  it("allows commit outside git repo", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-git-"));

    try {
      const output = await processInput(mockInput('git commit -m "test"', outsideDir));
      expect(output).toBeNull();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("hook process", () => {
  // Handing processInput a directory cannot catch main() resolving the branch
  // against its own working directory, because the test supplies the directory
  // either way. Drive the script the way Claude Code does instead: hook JSON on
  // stdin, spawned somewhere other than the repo the command targets.
  it("resolves the branch from the hook input, not the process directory", async () => {
    const testRepo = await createTestRepo();
    const spawnDir = await mkdtemp(join(tmpdir(), "outside-git-"));

    try {
      const input = mockInput('git commit -m "test"', testRepo);
      const proc = Bun.spawn(["bun", join(import.meta.dir, "block-default-branch-commit.ts")], {
        cwd: spawnDir,
        stdin: new TextEncoder().encode(JSON.stringify(input)),
        stdout: "pipe",
        stderr: "inherit",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(stdout.trim()).toBe(JSON.stringify(formatDenyOutput("main")));
    } finally {
      await rm(testRepo, { recursive: true, force: true });
      await rm(spawnDir, { recursive: true, force: true });
    }
  });
});
