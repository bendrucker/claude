import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { type LintEnv, MARKER_DIR, processInput } from "./lint";

function mockInput(command: string, cwd = "/repo"): PreToolUseHookInput {
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
    fileExists: (path) => path in files || touched.includes(path),
    readFile: (path) => files[path] ?? null,
    touch: (path) => touched.push(path),
  };
}

function decision(result: ReturnType<typeof processInput>) {
  const output = result?.hookSpecificOutput as
    | { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string }
    | undefined;
  return output;
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
      reason: "Pipe to jq",
    },
    {
      name: "-q shorthand on glab api",
      command: "glab api user -q .username",
      reason: "Pipe to jq",
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
      name: "hallucinated mergeRequestSetAutoMerge",
      command: `glab api graphql -f query="$(cat <<'GQL'\nmutation { mergeRequestSetAutoMerge } \nGQL\n)"`,
      reason: "merge.ts",
    },
    {
      name: "hallucinated mergeRequestRequestReview",
      command: "glab api graphql -f query='mutation { mergeRequestRequestReview }'",
      reason: "mergeRequestReviewerRereview",
    },
  ])("denies $name", ({ command, reason }) => {
    const output = decision(processInput(mockInput(command), fakeEnv()));
    expect(output?.permissionDecision).toBe("deny");
    expect(output?.permissionDecisionReason).toContain(reason);
  });

  test.each<{ name: string; command: string }>([
    { name: "plain glab api", command: "glab api projects/:id/merge_requests" },
    { name: "glab api piped to jq", command: "glab api user | jq -r .username" },
    { name: "grep -q in another pipeline segment", command: "glab api user | grep -q ben" },
    { name: "--output json", command: "glab mr view 42 --output json" },
    {
      name: "heredoc GraphQL with real dollars",
      command: `glab api graphql -f query="$(cat <<'GQL'\nmutation($projectPath: ID!) { mergeRequestReviewerRereview }\nGQL\n)"`,
    },
    { name: "gh --jq in a gh segment", command: "gh api repos/o/r --jq .name && glab mr list" },
  ])("allows $name", ({ command }) => {
    const env = fakeEnv(GITHUB_REPO);
    expect(processInput(mockInput(command), env)).toBeNull();
  });
});

describe("gh on a GitLab remote", () => {
  test.each<{ name: string; command: string }>([
    { name: "gh pr view", command: "gh pr view --json url,state" },
    { name: "gh pr list", command: "gh pr list" },
    { name: "gh issue view", command: "gh issue view 12" },
    { name: "gh pr after another command", command: "git push && gh pr view" },
  ])("denies $name", ({ command }) => {
    const output = decision(processInput(mockInput(command), fakeEnv(GITLAB_REPO)));
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
    { name: "gh api (reference lookups are legitimate)", command: "gh api repos/o/r", files: GITLAB_REPO },
    { name: "gh run view", command: "gh run view 123", files: GITLAB_REPO },
    { name: "no git repo at cwd", command: "gh pr view", files: {} },
    {
      name: "self-hosted non-gitlab remote",
      command: "gh pr view",
      files: { "/repo/.git/config": '[remote "origin"]\n\turl = git@git.company.com:g/p.git\n' },
    },
  ])("allows $name", ({ command, files }) => {
    expect(processInput(mockInput(command), fakeEnv(files))).toBeNull();
  });

  test("resolves the shared config through a worktree .git file", () => {
    const env = fakeEnv({
      "/repo/wt/.git": "gitdir: /repo/.git/worktrees/wt\n",
      "/repo/.git/config": GITLAB_REPO["/repo/.git/config"] as string,
    });
    const output = decision(processInput(mockInput("gh pr view", "/repo/wt"), env));
    expect(output?.permissionDecision).toBe("deny");
  });
});

describe("merge-request skill nudge", () => {
  const marker = `${MARKER_DIR}/test-session`;
  const nudgeMarker = `${MARKER_DIR}/test-session.nudged`;

  test.each<{ name: string; command: string }>([
    { name: "glab mr create", command: "git push && glab mr create --fill" },
    { name: "glab mr merge", command: "glab mr merge 42 --auto-merge" },
    { name: "merge train API", command: "glab api projects/:id/merge_trains/merge_requests/42 -X POST" },
    { name: "draft notes API", command: "glab api projects/:id/merge_requests/42/draft_notes" },
  ])("nudges once for $name", ({ command }) => {
    const env = fakeEnv();
    const output = decision(processInput(mockInput(command), env));
    expect(output?.permissionDecision).toBeUndefined();
    expect(output?.additionalContext).toContain("gitlab:merge-request");
    expect(env.touched).toContain(nudgeMarker);
  });

  test("stays quiet when the skill marker exists", () => {
    const env = fakeEnv({ [marker]: "" });
    expect(processInput(mockInput("glab mr create --fill"), env)).toBeNull();
  });

  test("stays quiet after a prior nudge", () => {
    const env = fakeEnv({ [nudgeMarker]: "" });
    expect(processInput(mockInput("glab mr merge 42"), env)).toBeNull();
  });

  test("does not nudge read-only glab commands", () => {
    const env = fakeEnv();
    expect(processInput(mockInput("glab mr view 42"), env)).toBeNull();
    expect(env.touched).toEqual([]);
  });
});

describe("pass-through", () => {
  test.each<[string]>([["git status"], ["bun test"], ["echo glab-adjacent"]])(
    "ignores %p",
    (command) => {
      expect(processInput(mockInput(command), fakeEnv())).toBeNull();
    },
  );

  test("ignores missing command", () => {
    const input = mockInput("");
    expect(processInput(input, fakeEnv())).toBeNull();
  });
});
