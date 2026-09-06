import { describe, expect, test } from "bun:test";
import type { CommandResult, Run } from "./exec";
import {
  createForge,
  forgeKind,
  joinPullRequests,
  MERGED_LIMIT,
  beyondMergedHorizon,
  ownedBy,
  parseRemote,
  pullRequestRef,
  slugParts,
  gitlabChecks,
  gitlabMergeState,
  mergeState,
  reviewState,
  rollUpChecks,
  SETTLED_STATE,
  type PullRequest,
} from "./forge";

function stub(replies: Record<string, Partial<CommandResult>>): { run: Run; calls: string[] } {
  const calls: string[] = [];
  const run: Run = (argv) => {
    const command = argv.join(" ");
    calls.push(command);
    const match = Object.entries(replies).find(([key]) => command.includes(key));
    return Promise.resolve({ ok: true, stdout: "", stderr: "", ...match?.[1] });
  };
  return { run, calls };
}

function pull(
  branch: string,
  number: number,
  state: PullRequest["state"],
  mergedAt: number | null = null,
): PullRequest {
  return { branch, number, state, mergedAt, ...SETTLED_STATE };
}

describe("parseRemote", () => {
  test.each([
    ["git@github.com:bendrucker/claude.git", "github.com", "bendrucker/claude"],
    ["https://github.com/vercel/streamdown.git", "github.com", "vercel/streamdown"],
    ["https://gitlab.com/group/sub/project", "gitlab.com", "group/sub/project"],
    ["ssh://git@gitlab.example.org:2222/team/app.git", "gitlab.example.org", "team/app"],
    ["git@GitHub.com:Owner/Repo", "github.com", "Owner/Repo"],
  ])("%s", (url, host, slug) => {
    expect(parseRemote(url)).toEqual({ host, slug });
  });

  test.each(["", "not-a-url", "local-only", "https://github.com/owner"])("rejects %s", (url) => {
    expect(parseRemote(url)).toBeNull();
  });
});

describe("forgeKind", () => {
  const cases: [string, string | null, "github" | "gitlab" | null][] = [
    ["github.com", null, "github"],
    ["gitlab.com", null, "gitlab"],
    ["gitlab.internal.example", null, "gitlab"],
    ["git.example.com", "git.example.com", "gitlab"],
    ["bitbucket.org", null, null],
    ["git.example.com", null, null],
  ];

  test.each(cases)("%s with configured %s", (host, configured, expected) => {
    expect(forgeKind(host, configured)).toBe(expected);
  });
});

test("slugParts keeps a nested GitLab namespace with the owner", () => {
  expect(slugParts("group/sub/project")).toEqual({ owner: "group/sub", repo: "project" });
  expect(slugParts("bendrucker/claude")).toEqual({ owner: "bendrucker", repo: "claude" });
});

test("ownedBy compares the root namespace and treats an unknown viewer as unowned", () => {
  expect(ownedBy("bendrucker/claude", "bendrucker")).toBe(true);
  expect(ownedBy("vercel/streamdown", "bendrucker")).toBe(false);
  expect(ownedBy("bendrucker/group/app", "bendrucker")).toBe(true);
  expect(ownedBy("bendrucker/claude", null)).toBe(false);
});

test.each([
  ["open", "#12"],
  ["draft", "draft#12"],
  ["merged", "merged#12"],
] as const)("pullRequestRef renders %s", (state, ref) => {
  expect(pullRequestRef(pull("b", 12, state))).toBe(ref);
});

describe("joinPullRequests", () => {
  test("an open pull request wins over a merged one on the same branch", () => {
    const joined = joinPullRequests([pull("reuse", 9, "open")], [pull("reuse", 4, "merged")]);
    expect(pullRequestRef(joined.get("reuse")!)).toBe("#9");
  });

  test("a branch with only a merged pull request keeps it", () => {
    const joined = joinPullRequests([], [pull("done", 4, "merged")]);
    expect(pullRequestRef(joined.get("done")!)).toBe("merged#4");
  });

  test("the first of several open pull requests on a branch wins", () => {
    const joined = joinPullRequests([pull("b", 1, "open"), pull("b", 2, "draft")], []);
    expect(joined.get("b")?.number).toBe(1);
  });
});

describe("beyondMergedHorizon", () => {
  const full = Array.from({ length: MERGED_LIMIT }, (_, index) =>
    pull(`b${index}`, index, "merged", 2000),
  );
  const candidate = (branch: string, commit: number | null, matched = false) => ({
    branch,
    commit,
    matched,
  });

  test("names an unmatched branch older than the oldest merge in a full window", () => {
    expect(beyondMergedHorizon(full, [candidate("old", 1000)])).toEqual(["old"]);
  });

  test("a branch inside the window is not at risk", () => {
    expect(beyondMergedHorizon(full, [candidate("recent", 3000)])).toEqual([]);
  });

  test("a branch that already matched a pull request is settled whatever its age", () => {
    expect(beyondMergedHorizon(full, [candidate("old", 1000, true)])).toEqual([]);
  });

  test("a window that did not fill cannot have a horizon", () => {
    expect(beyondMergedHorizon(full.slice(0, 5), [candidate("old", 1000)])).toEqual([]);
  });

  test("an undated branch cannot be placed against the window", () => {
    expect(beyondMergedHorizon(full, [candidate("undated", null)])).toEqual([]);
  });

  test("names every at-risk branch, sorted", () => {
    expect(
      beyondMergedHorizon(full, [
        candidate("zeta", 1000),
        candidate("alpha", 900),
        candidate("recent", 3000),
      ]),
    ).toEqual(["alpha", "zeta"]);
  });
});

describe("github", () => {
  test("reads open and merged pull requests and marks drafts", async () => {
    const { run, calls } = stub({
      "--state open": {
        stdout: JSON.stringify([
          {
            number: 1,
            headRefName: "a",
            isDraft: true,
            mergeStateStatus: "BLOCKED",
            reviewDecision: "CHANGES_REQUESTED",
            statusCheckRollup: [
              { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
            ],
          },
        ]),
      },
      "--state merged": {
        stdout: '[{"number":2,"headRefName":"b","mergedAt":"2026-01-01T00:00:00Z"}]',
      },
    });
    const listing = await createForge("github", run).pullRequests("o/r");

    expect(listing.open).toEqual([
      {
        branch: "a",
        number: 1,
        state: "draft",
        mergedAt: null,
        checks: "failing",
        failing: ["lint"],
        review: "changes-requested",
        mergeState: "blocked",
      },
    ]);
    expect(listing.merged).toEqual([
      { branch: "b", number: 2, state: "merged", mergedAt: 1_767_225_600, ...SETTLED_STATE },
    ]);
    expect(calls.every((call) => call.includes("--author @me"))).toBe(true);
  });

  // The merged query returns a hundred rows whose check history nothing reads.
  test("asks for check and review state on the open query only", async () => {
    const { run, calls } = stub({ "pr list": { stdout: "[]" } });
    await createForge("github", run).pullRequests("o/r");

    const [open, merged] = calls.filter((call) => call.includes("pr list"));
    expect(open).toContain("statusCheckRollup");
    expect(merged).not.toContain("statusCheckRollup");
  });

  test("a listing without a rollup reports checks it cannot read", async () => {
    const { run } = stub({
      "--state open": { stdout: '[{"number":1,"headRefName":"a"}]' },
      "--state merged": { stdout: "[]" },
    });
    expect((await createForge("github", run).pullRequests("o/r")).open).toEqual([
      {
        branch: "a",
        number: 1,
        state: "open",
        mergedAt: null,
        checks: "unknown",
        failing: [],
        review: "none",
        mergeState: "unknown",
      },
    ]);
  });

  test("a failed listing reports null rather than an empty repository", async () => {
    const { run } = stub({
      "--state open": { ok: false, stderr: "boom" },
      "--state merged": { stdout: "[]" },
    });
    const listing = await createForge("github", run).pullRequests("o/r");
    expect(listing.open).toBeNull();
    expect(listing.merged).toEqual([]);
  });

  test("a fork resolves to the parent slug", async () => {
    const { run } = stub({
      "repo view": {
        stdout: JSON.stringify({
          isFork: true,
          nameWithOwner: "bendrucker/extensions",
          parent: { name: "extensions", owner: { login: "raycast" } },
        }),
      },
    });
    expect(await createForge("github", run).identity("bendrucker/extensions")).toEqual({
      slug: "raycast/extensions",
      forkOf: "bendrucker/extensions",
      resolved: true,
    });
  });

  test("a repository that is not a fork keeps its own slug", async () => {
    const { run } = stub({
      "repo view": {
        stdout: JSON.stringify({ isFork: false, nameWithOwner: "vercel/streamdown", parent: null }),
      },
    });
    expect(await createForge("github", run).identity("vercel/streamdown")).toEqual({
      slug: "vercel/streamdown",
      forkOf: null,
      resolved: true,
    });
  });

  test("a failed fork lookup is reported as unresolved", async () => {
    const { run } = stub({ "repo view": { ok: false } });
    expect(await createForge("github", run).identity("o/r")).toEqual({
      slug: "o/r",
      forkOf: null,
      resolved: false,
    });
  });

  test("the viewer is fetched once for many repositories", async () => {
    const { run, calls } = stub({ "api user": { stdout: '{"login":"bendrucker"}' } });
    const forge = createForge("github", run);
    expect(await Promise.all([forge.viewer(), forge.viewer()])).toEqual([
      "bendrucker",
      "bendrucker",
    ]);
    expect(calls.filter((call) => call.includes("api user"))).toHaveLength(1);
  });
});

describe("gitlab", () => {
  test("reads iid and source_branch and separates the merged query", async () => {
    const { run, calls } = stub({
      "api user": { stdout: '{"username":"ben"}' },
      "--merged": {
        stdout: '[{"iid":7,"source_branch":"done","merged_at":"2026-01-01T00:00:00Z"}]',
      },
      "mr list": {
        stdout: JSON.stringify([
          {
            iid: 5,
            source_branch: "wip",
            draft: true,
            has_conflicts: true,
            pipeline: { status: "failed" },
          },
        ]),
      },
    });
    const listing = await createForge("gitlab", run).pullRequests("group/app");

    expect(listing.open).toEqual([
      {
        branch: "wip",
        number: 5,
        state: "draft",
        mergedAt: null,
        checks: "failing",
        failing: [],
        review: "unknown",
        mergeState: "conflicting",
      },
    ]);
    expect(listing.merged).toEqual([
      { branch: "done", number: 7, state: "merged", mergedAt: 1_767_225_600, ...SETTLED_STATE },
    ]);
    expect(calls.some((call) => call.includes("--author ben"))).toBe(true);
  });

  test("an unresolved viewer refuses to widen the query", async () => {
    const { run, calls } = stub({ "api user": { ok: false } });
    expect(await createForge("gitlab", run).pullRequests("group/app")).toEqual({
      open: null,
      merged: null,
    });
    expect(calls.some((call) => call.includes("mr list"))).toBe(false);
  });

  test("forked_from_project names the parent", async () => {
    const { run } = stub({
      "repo view": {
        stdout: JSON.stringify({
          path_with_namespace: "ben/app",
          forked_from_project: { path_with_namespace: "team/app" },
        }),
      },
    });
    expect(await createForge("gitlab", run).identity("ben/app")).toEqual({
      slug: "team/app",
      forkOf: "ben/app",
      resolved: true,
    });
  });
});

describe("rollUpChecks", () => {
  const run = (name: string, conclusion: string) => ({
    name,
    status: "COMPLETED",
    conclusion,
  });

  test("no checks is not a passing bar", () => {
    expect(rollUpChecks([])).toEqual({ checks: "none", failing: [] });
  });

  test("names every failing job, sorted and deduplicated", () => {
    expect(
      rollUpChecks([
        run("lint", "FAILURE"),
        run("build", "TIMED_OUT"),
        run("lint", "FAILURE"),
        run("test", "SUCCESS"),
      ]),
    ).toEqual({ checks: "failing", failing: ["build", "lint"] });
  });

  test("a failure outranks a job still running", () => {
    expect(rollUpChecks([{ name: "slow", status: "IN_PROGRESS" }, run("lint", "FAILURE")])).toEqual(
      { checks: "failing", failing: ["lint"] },
    );
  });

  test("an incomplete run is not read through its missing conclusion", () => {
    expect(rollUpChecks([{ name: "slow", status: "QUEUED" }])).toEqual({
      checks: "running",
      failing: [],
    });
  });

  test("a StatusContext reports through state instead of conclusion", () => {
    expect(rollUpChecks([{ context: "ci/legacy", state: "FAILURE" }])).toEqual({
      checks: "failing",
      failing: ["ci/legacy"],
    });
    expect(rollUpChecks([{ context: "ci/legacy", state: "PENDING" }])).toEqual({
      checks: "running",
      failing: [],
    });
    expect(rollUpChecks([{ context: "ci/legacy", state: "SUCCESS" }])).toEqual({
      checks: "passing",
      failing: [],
    });
  });

  test.each(["SUCCESS", "NEUTRAL", "SKIPPED"])("%s does not hold the bar", (conclusion) => {
    expect(rollUpChecks([run("optional", conclusion)]).checks).toBe("passing");
  });

  test("an unnamed check still reports", () => {
    expect(rollUpChecks([{ status: "COMPLETED", conclusion: "FAILURE" }])).toEqual({
      checks: "failing",
      failing: ["check"],
    });
  });
});

describe("reviewState", () => {
  test.each([
    ["APPROVED", "approved"],
    ["CHANGES_REQUESTED", "changes-requested"],
    ["REVIEW_REQUIRED", "review-required"],
    // GitHub answers with an empty string where no review is required.
    ["", "none"],
    [null, "none"],
    ["SOMETHING_NEW", "unknown"],
  ] as const)("%s", (decision, expected) => {
    expect(reviewState(decision)).toBe(expected);
  });
});

describe("mergeState", () => {
  test.each([
    ["CLEAN", "clean"],
    ["HAS_HOOKS", "clean"],
    ["DIRTY", "conflicting"],
    ["BEHIND", "behind"],
    ["BLOCKED", "blocked"],
    ["UNSTABLE", "unstable"],
    ["UNKNOWN", "unknown"],
    [null, "unknown"],
  ] as const)("%s", (status, expected) => {
    expect(mergeState(status)).toBe(expected);
  });
});

describe("gitlab state", () => {
  test.each([
    ["mergeable", undefined, "clean"],
    ["conflict", undefined, "conflicting"],
    ["not_approved", undefined, "blocked"],
    ["need_rebase", undefined, "behind"],
    [null, undefined, "unknown"],
    // A conflict flag settles the row whatever the detailed status says.
    ["mergeable", true, "conflicting"],
  ] as const)("%s with conflicts %s", (detailed, conflicts, expected) => {
    expect(gitlabMergeState(detailed, conflicts)).toBe(expected);
  });

  test.each([
    ["success", "passing"],
    ["failed", "failing"],
    ["canceled", "failing"],
    ["running", "running"],
    ["skipped", "passing"],
    // A listing with no pipeline attached says nothing about the checks.
    [null, "unknown"],
    ["invented", "unknown"],
  ] as const)("pipeline %s", (status, expected) => {
    expect(gitlabChecks(status)).toBe(expected);
  });
});
