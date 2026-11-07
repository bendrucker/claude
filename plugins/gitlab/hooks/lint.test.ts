import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultEnv, type HookInput, type LintEnv, MARKER_DIR, processInput } from "./lint";

function mockInput(command: string, cwd = "/repo"): HookInput {
  return {
    session_id: "test-session",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    transcript_path: "/tmp/transcript.json",
    cwd,
    tool_use_id: "test",
  };
}

function fakeEnv(files: Record<string, string> = {}): LintEnv & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    fileExists: (path) => Promise.resolve(path in files || touched.includes(path)),
    readFile: (path) => Promise.resolve(files[path] ?? null),
    touch: (path) => {
      touched.push(path);
      return Promise.resolve();
    },
  };
}

function decision(result: Awaited<ReturnType<typeof processInput>>) {
  const output = result?.hookSpecificOutput;
  return output?.hookEventName === "PreToolUse" ? output : undefined;
}

const GITLAB_REPO = {
  "/repo/.git/config": '[remote "origin"]\n\turl = git@gitlab.com:group/project.git\n',
};
const GITHUB_REPO = {
  "/repo/.git/config": '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n',
};

describe("glab gh-ism denials", () => {
  test.each<{ name: string; command: string; reason: string }>([
    {
      name: "--jq on glab api",
      command: "glab api projects/:id/merge_requests --jq '.[].iid'",
      reason: "Pipe instead",
    },
    {
      name: "-q shorthand on glab api",
      command: "glab api user -q .username",
      reason: "Pipe instead",
    },
    {
      name: "--json on glab mr list",
      command: "glab mr list --json title,url",
      reason: "--output json",
    },
    {
      name: "escaped dollars in inline GraphQL",
      command: `glab api graphql -f query='mutation(\\$projectPath: ID\\!) { x }'`,
      reason: "quoted heredoc",
    },
    {
      name: "--jq despite a quoted pipe in the endpoint",
      command: `glab api "projects/:id/issues?labels=bug|urgent" --jq '.[].iid'`,
      reason: "Pipe instead",
    },
    {
      name: "hallucinated mergeRequestSetAutoMerge",
      command: `glab api graphql -f query="$(cat <<'GQL'\nmutation { mergeRequestSetAutoMerge } \nGQL\n)"`,
      reason: "merge.ts",
    },
    {
      name: "hallucinated mergeRequestRequestReview",
      command: "glab api graphql -f query='mutation { mergeRequestRequestReview }'",
      reason: "mergeRequestReviewerRereview",
    },
  ])("denies $name", async ({ command, reason }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv()));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain(reason);
  });

  test.each<{ name: string; command: string }>([
    { name: "plain glab api", command: "glab api projects/:id/merge_requests" },
    { name: "glab api piped to jq", command: "glab api user | jq -r .username" },
    { name: "grep -q in another pipeline segment", command: "glab api user | grep -q ben" },
    { name: "--output json", command: "glab mr view 42 --output json" },
    {
      name: "-q inside a quoted field value",
      command: "glab api projects/:id/issues --field 'description=pass -q for quiet mode'",
    },
    {
      name: "escaped dollar in a downstream awk stage",
      command: `glab api graphql -f query='{ project { id } }' | jq -r .data | awk "{print \\$1}"`,
    },
    {
      name: "heredoc GraphQL with real dollars",
      command: `glab api graphql -f query="$(cat <<'GQL'\nmutation($projectPath: ID!) { mergeRequestReviewerRereview }\nGQL\n)"`,
    },
    { name: "gh --jq in a gh segment", command: "gh api repos/o/r --jq .name && glab mr list" },
  ])("allows $name", async ({ command }) => {
    const env = fakeEnv(GITHUB_REPO);
    expect(await processInput(mockInput(command), env)).toBeNull();
  });

  test.each<{ name: string; command: string }>([
    {
      name: "--json inside a quoted note body",
      command: `glab mr note 5 -m "renamed --json to --output json"`,
    },
    {
      name: "mutation name inside a quoted note body",
      command: "glab mr note 42 -m 'Confirmed mergeRequestSetAutoMerge is not in the schema'",
    },
    {
      name: "mutation name in a note compounded after a valid graphql call",
      command:
        "glab api graphql -f query='{ project { id } }' && glab mr note 42 -m 'mergeRequestSetAutoMerge is not in the schema'",
    },
  ])("does not deny $name", async ({ command }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv(GITHUB_REPO)));
    expect(output?.permissionDecision).toBeUndefined();
  });
});

describe("command-position matching", () => {
  test.each<{ name: string; command: string }>([
    {
      name: "gh pr create whose heredoc body mentions glab --json",
      command: "gh pr create --title t --body-file - <<'EOF'\nglab has no --json flag\nEOF",
    },
    {
      name: "gh pr create with the body in a quoted command substitution",
      command: `gh pr create -R o/r --title t --body "$(cat <<'EOF'\nglab has no --json flag and glab api --jq fails\nEOF\n)"`,
    },
    { name: "echo mentioning glab --json", command: "echo glab list --json" },
    { name: "grep for a glab flag", command: "grep -rn 'glab api --jq' docs" },
    { name: "comment after the command", command: "git status # glab mr list --json" },
  ])("allows $name", async ({ command }) => {
    expect(await processInput(mockInput(command), fakeEnv(GITHUB_REPO))).toBeNull();
  });

  test.each<{ name: string; command: string; reason: string }>([
    {
      name: "after env assignments",
      command: "GLAB_DEBUG=1 glab mr list --json x",
      reason: "--output json",
    },
    { name: "after command", command: "command glab mr list --json x", reason: "--output json" },
    {
      name: "inside a substitution",
      command: "echo $(glab mr list --json x)",
      reason: "--output json",
    },
    { name: "after a pipe", command: "echo x | glab mr list --json x", reason: "--output json" },
  ])("denies glab $name", async ({ command, reason }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv(GITHUB_REPO)));
    expect(output?.permissionDecisionReason).toContain(reason);
  });

  test.each<{ name: string; command: string }>([
    { name: "glab mr view --jq", command: "glab mr view 42 --jq .iid" },
    { name: "glab ci get --jq", command: "glab ci get --jq .status" },
  ])("does not flag $name", async ({ command }) => {
    expect(await processInput(mockInput(command), fakeEnv(GITHUB_REPO))).toBeNull();
  });
});

describe("GraphQL dollar escapes", () => {
  test.each<{ name: string; command: string }>([
    {
      name: "escaped dollars inside a double-quoted value",
      command: `glab api graphql -f query="mutation(\\$projectPath: ID!) { x }"`,
    },
    {
      name: "escaped dollars in a downstream quoted awk",
      command: `glab api graphql -f query='{ project { id } }' | awk "{print \\$1}"`,
    },
    {
      name: "escaped dollars in an unquoted heredoc",
      command: `glab api graphql -f query="$(cat <<GQL\nquery(\\$p: ID!) { x }\nGQL\n)"`,
    },
  ])("allows $name", async ({ command }) => {
    expect(await processInput(mockInput(command), fakeEnv(GITHUB_REPO))).toBeNull();
  });

  test("denies escaped dollars in a quoted heredoc", async () => {
    const command = `glab api graphql -f query="$(cat <<'GQL'\nquery(\\$p: ID!) { x }\nGQL\n)"`;
    const output = decision(await processInput(mockInput(command), fakeEnv()));
    expect(output?.permissionDecision).toBe("deny");
  });
});

describe("gh on a GitLab remote, false denies", () => {
  test.each<{ name: string; command: string }>([
    { name: "GH_REPO prefix", command: "GH_REPO=o/r gh pr view 1" },
    { name: "github.com URL argument", command: "gh pr view https://github.com/o/r/pull/1" },
    { name: "an earlier cd", command: "cd ~/src/github-repo && gh pr view" },
    { name: "an earlier git -C", command: "git -C ~/src/github-repo fetch && gh pr view" },
    { name: "gh in a heredoc body", command: "cat <<'EOF'\ngh pr view\nEOF" },
  ])("allows $name", async ({ command }) => {
    expect(await processInput(mockInput(command), fakeEnv(GITLAB_REPO))).toBeNull();
  });
});

describe("@file references", () => {
  test.each<{ name: string; command: string; reason: string }>([
    {
      name: "quoted absolute path to mr note",
      command: `glab mr note 42 -m "@/tmp/claude/comment.md"`,
      reason: "glab mr note create <iid> < /tmp/claude/comment.md",
    },
    {
      name: "unquoted $TMPDIR path to issue note",
      command: "glab issue note 7 --message @$TMPDIR/reply.md",
      reason: "glab issue note <iid> < $TMPDIR/reply.md",
    },
    {
      name: "relative markdown file to mr create",
      command: "git push && glab mr create --title 'Fix' --description @body.md",
      reason: "--description-file body.md",
    },
    {
      name: "= form on mr update",
      command: "glab mr update 42 --description='@./desc.md'",
      reason: "--description-file ./desc.md",
    },
    {
      name: "-f raw field on glab api",
      command: "glab api projects/:id/merge_requests/42/notes -X POST -f body=@/tmp/note.md",
      reason: "Use -F body=@/tmp/note.md",
    },
  ])("denies $name", async ({ command, reason }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv()));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain(reason);
  });

  test.each<{ name: string; command: string }>([
    {
      name: "-F field on glab api, which reads the file",
      command: "glab api projects/:id/merge_requests/42/notes -X POST -F body=@/tmp/note.md",
    },
    { name: "body read with cat", command: `glab mr note 42 -m "$(cat /tmp/note.md)"` },
    {
      name: "body opening with a mention",
      command: `glab mr note 42 -m "@alice can you take a look?"`,
    },
    { name: "reviewer username", command: "glab mr update 42 --reviewer @alice" },
    {
      name: "body that is only a mention",
      command: "glab mr note 42 -m '@alice'",
    },
    {
      name: "gh with an @file body",
      command: "gh api repos/o/r/issues/1/comments -F body=@/tmp/x.md",
    },
  ])("allows $name", async ({ command }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv(GITHUB_REPO)));
    expect(output?.permissionDecision).toBeUndefined();
  });
});

describe("gh on a GitLab remote", () => {
  test.each<{ name: string; command: string }>([
    { name: "gh pr view", command: "gh pr view --json url,state" },
    { name: "gh pr list", command: "gh pr list" },
    { name: "gh issue view", command: "gh issue view 12" },
    { name: "gh pr after another command", command: "git push && gh pr view" },
  ])("denies $name", async ({ command }) => {
    const output = decision(await processInput(mockInput(command), fakeEnv(GITLAB_REPO)));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain("glab");
  });

  test.each<{ name: string; command: string; files: Record<string, string> }>([
    { name: "gh pr on a GitHub remote", command: "gh pr view", files: GITHUB_REPO },
    {
      name: "explicit -R targeting GitHub",
      command: "gh pr view -R owner/repo",
      files: GITLAB_REPO,
    },
    {
      name: "explicit --repo targeting GitHub",
      command: "gh pr list --repo owner/repo",
      files: GITLAB_REPO,
    },
    {
      name: "gh api (reference lookups are legitimate)",
      command: "gh api repos/o/r",
      files: GITLAB_REPO,
    },
    { name: "gh run view", command: "gh run view 123", files: GITLAB_REPO },
    { name: "no git repo at cwd", command: "gh pr view", files: {} },
    {
      name: "self-hosted non-gitlab remote",
      command: "gh pr view",
      files: { "/repo/.git/config": '[remote "origin"]\n\turl = git@git.company.com:g/p.git\n' },
    },
  ])("allows $name", async ({ command, files }) => {
    expect(await processInput(mockInput(command), fakeEnv(files))).toBeNull();
  });

  test("resolves the shared config through a worktree .git file", async () => {
    const env = fakeEnv({
      "/repo/wt/.git": "gitdir: /repo/.git/worktrees/wt\n",
      "/repo/.git/config": GITLAB_REPO["/repo/.git/config"],
    });
    const output = decision(await processInput(mockInput("gh pr view", "/repo/wt"), env));
    expect(output?.permissionDecision).toBe("deny");
  });
});

describe("merge-request skill nudge", () => {
  const marker = `${MARKER_DIR}/test-session`;
  const nudgeMarker = `${MARKER_DIR}/test-session.nudged`;

  test.each<{ name: string; command: string }>([
    { name: "glab mr create", command: "git push && glab mr create --fill" },
    { name: "glab mr merge", command: "glab mr merge 42 --auto-merge" },
    {
      name: "merge train API",
      command: "glab api projects/:id/merge_trains/merge_requests/42 -X POST",
    },
    { name: "draft notes API", command: "glab api projects/:id/merge_requests/42/draft_notes" },
  ])("nudges once for $name", async ({ command }) => {
    const env = fakeEnv();
    const output = decision(await processInput(mockInput(command), env));
    expect(output?.permissionDecision).toBeUndefined();
    expect(output?.additionalContext).toContain("gitlab:merge-request");
    expect(env.touched).toContain(nudgeMarker);
  });

  test("stays quiet when the skill marker exists", async () => {
    const env = fakeEnv({ [marker]: "" });
    expect(await processInput(mockInput("glab mr create --fill"), env)).toBeNull();
  });

  test("stays quiet after a prior nudge", async () => {
    const env = fakeEnv({ [nudgeMarker]: "" });
    expect(await processInput(mockInput("glab mr merge 42"), env)).toBeNull();
  });

  test("does not nudge read-only glab commands", async () => {
    const env = fakeEnv();
    expect(await processInput(mockInput("glab mr view 42"), env)).toBeNull();
    expect(env.touched).toEqual([]);
  });

  test.each<{ name: string; command: string }>([
    { name: "glab mr note --help", command: "glab mr note --help" },
    { name: "glab mr create -h", command: "glab mr create -h" },
    { name: "glab mr note list", command: "glab mr note list 42" },
    { name: "a quoted body that mentions glab mr update", command: "echo 'run glab mr update 5'" },
  ])("does not nudge $name", async ({ command }) => {
    const env = fakeEnv();
    expect(await processInput(mockInput(command), env)).toBeNull();
    expect(env.touched).toEqual([]);
  });

  test("defaultEnv.touch writes the marker before the marker directory exists", async () => {
    const base = mkdtempSync(join(tmpdir(), "gitlab-lint-"));
    const markerPath = join(base, "gitlab-skill", "session.nudged");
    await defaultEnv.touch(markerPath);
    expect(await defaultEnv.fileExists(markerPath)).toBe(true);
  });
});

describe("CI polling nudge", () => {
  const pollingMarker = `${MARKER_DIR}/test-session.polling`;

  test.each<{ name: string; command: string }>([
    {
      name: "for seq loop",
      command: "for i in $(seq 1 30); do glab ci status -b main; sleep 20; done",
    },
    {
      name: "for seq loop without sleep",
      command: "for i in $(seq 1 3); do glab ci get -b main; done",
    },
    {
      name: "until loop",
      command:
        "until glab ci get -b main -F json | jq -e '.status == \"success\"'; do sleep 30; done",
    },
    { name: "while loop", command: "while glab ci status | grep -q running; do sleep 30; done" },
    { name: "sleep then query", command: "sleep 120 && glab mr view 42 --output json" },
    {
      name: "pipeline API",
      command: "sleep 60; glab api projects/:id/pipelines/123 | jq .status",
    },
  ])("nudges once for $name", async ({ command }) => {
    const env = fakeEnv();
    const output = decision(await processInput(mockInput(command), env));
    expect(output?.permissionDecision).toBeUndefined();
    expect(output?.additionalContext).toContain("watch.ts");
    expect(output?.additionalContext).toContain("persistent: true");
    expect(env.touched).toContain(pollingMarker);
  });

  test("stays quiet after the first nudge", async () => {
    const env = fakeEnv({ [pollingMarker]: "" });
    expect(await processInput(mockInput("sleep 5 && glab ci status"), env)).toBeNull();
  });

  test.each<{ name: string; command: string }>([
    { name: "a single status read", command: "glab ci status -b main" },
    {
      name: "a loop with no glab query",
      command: "for i in $(seq 1 3); do echo $i; sleep 1; done",
    },
    { name: "a batch over a list", command: "for mr in 1 2 3; do glab mr view $mr; done" },
    {
      name: "a loop and glab only in a heredoc body",
      command: "gh pr create --body-file - <<'EOF'\nuntil glab ci status; do sleep 5; done\nEOF",
    },
  ])("does not nudge $name", async ({ command }) => {
    const env = fakeEnv(GITHUB_REPO);
    expect(await processInput(mockInput(command), env)).toBeNull();
    expect(env.touched).toEqual([]);
  });
});

describe("pass-through", () => {
  test.each<[string]>([["git status"], ["bun test"], ["echo glab-adjacent"]])(
    "ignores %p",
    async (command) => {
      expect(await processInput(mockInput(command), fakeEnv())).toBeNull();
    },
  );

  test("ignores missing command", async () => {
    const input = mockInput("");
    expect(await processInput(input, fakeEnv())).toBeNull();
  });
});

async function runHook(payload: string) {
  const hook = Bun.spawn(["bun", join(import.meta.dir, "lint.ts")], {
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(hook.stdout).text(),
    new Response(hook.stderr).text(),
    hook.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("undecodable payload", () => {
  test.each<{ name: string; payload: string }>([
    { name: "not JSON", payload: "not json" },
    {
      name: "missing cwd",
      payload: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s" }),
    },
  ])("$name logs and exits 0", async ({ payload }) => {
    const { stdout, stderr, exitCode } = await runHook(payload);
    expect(stderr).toContain("[gitlab/lint] Failed to parse hook input:");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});

async function holdsNodeModules(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).includes("node_modules");
  } catch {
    return false;
  }
}

describe("dependency-free execution", () => {
  const base = mkdtempSync(join(tmpdir(), "gitlab-lint-isolated-"));

  async function runCopy(command: string) {
    const dir = join(base, "hooks");
    await mkdir(dir, { recursive: true });
    for (const file of ["lint.ts", "command-segments.ts", "hook-input.ts"]) {
      // oxlint-disable-next-line no-await-in-loop -- three small sequential copies
      await Bun.write(join(dir, file), Bun.file(join(import.meta.dirname, file)));
    }
    const hook = Bun.spawn(["bun", "--no-install", join(dir, "lint.ts")], {
      cwd: dir,
      stdin: new TextEncoder().encode(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: "isolated",
          cwd: base,
          tool_name: "Bash",
          tool_input: { command },
        }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(hook.stdout).text(),
      new Response(hook.stderr).text(),
      hook.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test("has no node_modules above the copy", async () => {
    const dirs: string[] = [];
    for (let dir = join(base, "hooks"); dirs.at(-1) !== dir; dir = join(dir, "..")) dirs.push(dir);
    expect(await Promise.all(dirs.map(holdsNodeModules))).not.toContain(true);
  });

  test("still denies a gh-ism", async () => {
    const { stdout, stderr, exitCode } = await runCopy("glab mr list --json x");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"permissionDecision":"deny"');
  });
});
