import { describe, expect, test } from "bun:test";
import type { BoardPull, BoardRow, Disposition, RowState } from "./board";
import { classify, collapsedLines, countLine, groupByDisposition, pullFlags } from "./disposition";
import type { PullState } from "./forge";

function pull(overrides: Partial<BoardPull> = {}): BoardPull {
  return {
    ref: "#1",
    number: 1,
    state: "open",
    checks: "passing",
    failing: [],
    review: "none",
    mergeState: "clean",
    ...overrides,
  };
}

function state(overrides: Partial<RowState> = {}): RowState {
  return {
    self: false,
    working: false,
    blocked: false,
    pullUnknown: false,
    status: "clean",
    unpushed: 0,
    carried: 0,
    mergedBranch: false,
    reused: false,
    ...overrides,
  };
}

function row(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    kind: "worktree",
    pane: null,
    agent: null,
    owner: "bendrucker",
    repo: "claude",
    slug: "bendrucker/claude",
    forkOf: null,
    ownedByViewer: true,
    repoLabel: "claude",
    branch: "topic",
    detached: false,
    worktree: "/wt/topic",
    pull: null,
    prColumn: "-",
    age: 0,
    flags: ["clean"],
    state: state(),
    disposition: "parked",
    ...overrides,
  };
}

describe("an open pull request", () => {
  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    {
      name: "green in your own repository is a merge decision",
      row: row({ pull: pull() }),
      expected: "merge",
    },
    {
      name: "with a failing check is yours to fix",
      row: row({ pull: pull({ checks: "failing", failing: ["lint"], mergeState: "blocked" }) }),
      expected: "needs-you",
    },
    {
      name: "that conflicts is yours to rebase",
      row: row({ pull: pull({ mergeState: "conflicting" }) }),
      expected: "needs-you",
    },
    {
      name: "with changes requested is yours to address",
      row: row({ pull: pull({ review: "changes-requested" }) }),
      expected: "needs-you",
    },
    {
      name: "green in a repository you do not own waits on its maintainer",
      row: row({ ownedByViewer: false, pull: pull({ review: "review-required" }) }),
      expected: "waiting",
    },
    {
      name: "conflicting in a repository you do not own is still yours to rebase",
      row: row({ ownedByViewer: false, pull: pull({ mergeState: "conflicting" }) }),
      expected: "needs-you",
    },
    {
      name: "failing in a repository you do not own is still yours to fix",
      row: row({ ownedByViewer: false, pull: pull({ checks: "failing", failing: ["build"] }) }),
      expected: "needs-you",
    },
    {
      name: "with checks still running waits on CI",
      row: row({ pull: pull({ checks: "running", mergeState: "blocked" }) }),
      expected: "waiting",
    },
    {
      name: "in draft is the author saying it is not ready",
      row: row({ pull: pull({ state: "draft", checks: "failing", failing: ["lint"] }) }),
      expected: "waiting",
    },
    {
      name: "green but behind its base needs an update",
      row: row({ pull: pull({ mergeState: "behind" }) }),
      expected: "needs-you",
    },
    {
      name: "green but blocked by a gate the board cannot name is read by hand",
      row: row({ pull: pull({ mergeState: "blocked" }) }),
      expected: "needs-you",
    },
    {
      name: "whose forge would not report its checks is read by hand",
      row: row({ pull: pull({ checks: "unknown", mergeState: "unknown", review: "unknown" }) }),
      expected: "needs-you",
    },
    {
      name: "with no checks configured at all does not pass for green",
      row: row({ pull: pull({ checks: "none" }) }),
      expected: "needs-you",
    },
  ])("$name", ({ row: subject, expected }) => {
    expect(classify(subject)).toBe(expected);
  });
});

describe("a merged pull request", () => {
  const merged = pull({ state: "merged", ref: "merged#1", checks: "none", mergeState: "unknown" });

  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    {
      name: "with nothing left in the tree is a cleanup",
      row: row({ pull: merged }),
      expected: "cleanup",
    },
    {
      name: "with commits the merge did not take needs a fresh branch",
      row: row({ pull: merged, state: state({ unpushed: 13 }) }),
      expected: "needs-you",
    },
    {
      name: "whose ahead count git would not report is not assumed pushed",
      row: row({ pull: merged, state: state({ unpushed: null }) }),
      expected: "needs-you",
    },
    {
      name: "under a recycled branch name belongs to different work",
      row: row({ pull: merged, state: state({ reused: true }) }),
      expected: "needs-you",
    },
    {
      name: "leaving only an uncommitted tree is parked",
      row: row({ pull: merged, state: state({ status: "dirty" }) }),
      expected: "parked",
    },
    {
      name: "leaving only carried files is parked",
      row: row({ pull: merged, state: state({ carried: 10 }) }),
      expected: "parked",
    },
    {
      name: "on a branch merged into the base without a pull request still cleans up",
      row: row({ state: state({ mergedBranch: true }) }),
      expected: "cleanup",
    },
  ])("$name", ({ row: subject, expected }) => {
    expect(classify(subject)).toBe(expected);
  });
});

describe("a row with no pull request", () => {
  test("is parked, because nothing on the board will move it", () => {
    expect(classify(row({ state: state({ status: "dirty", unpushed: 3 }) }))).toBe("parked");
  });

  // Absent because the forge refused to answer is not absent.
  test("is raised when the forge would not list pull requests", () => {
    expect(classify(row({ state: state({ pullUnknown: true }) }))).toBe("needs-you");
  });

  // git failing to read a checkout is the same class of silence.
  test("is raised when git would not report the status", () => {
    expect(classify(row({ state: state({ status: "unreadable" }) }))).toBe("needs-you");
  });
});

describe("a detached worktree", () => {
  const detached = (overrides: Partial<RowState> = {}): BoardRow =>
    row({ branch: null, detached: true, state: state(overrides) });

  // A branch deleted after its merge leaves the worktree detached, and its
  // commits have no branch left to reach the forge on.
  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    { name: "carrying commits is raised", row: detached({ unpushed: 4 }), expected: "needs-you" },
    {
      name: "with an uncountable ahead is raised",
      row: detached({ unpushed: null }),
      expected: "needs-you",
    },
    { name: "with nothing above the base parks", row: detached(), expected: "parked" },
    {
      name: "is never offered for cleanup",
      row: detached({ carried: 1 }),
      expected: "parked",
    },
  ])("$name", ({ row: subject, expected }) => {
    expect(classify(subject)).toBe(expected);
  });
});

describe("an agent resting in the pane", () => {
  const merged = pull({ state: "merged", ref: "merged#1", checks: "none", mergeState: "unknown" });
  const held = (agent: string, overrides: Partial<RowState> = {}): BoardRow =>
    row({ pane: "wC1:p1", agent, pull: merged, state: state(overrides) });

  // The pane holding an agent owns its worktree, and herdr splits one resting
  // state into idle and done by whether the tab has been seen. An agent
  // between the turns of a running workflow reads idle, so a cleanup offered
  // against that row removes the tree the run is working in.
  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    { name: "idle never reads as finished", row: held("claude/idle"), expected: "working" },
    { name: "done never reads as finished", row: held("claude/done"), expected: "working" },
    {
      name: "with a status herdr would not report holds the tree all the same",
      row: held("claude/?"),
      expected: "working",
    },
    {
      name: "mid-turn holds the tree",
      row: held("claude/working", { working: true }),
      expected: "working",
    },
    {
      name: "stopped on a prompt is the user's to answer",
      row: held("claude/blocked", { blocked: true }),
      expected: "needs-you",
    },
  ])("$name", ({ row: subject, expected }) => {
    expect(classify(subject)).toBe(expected);
  });

  test("a shell sitting in the worktree is a person's prompt, not an agent", () => {
    expect(classify(held("shell/idle"))).toBe("cleanup");
  });

  test("a worktree no pane holds is still a cleanup", () => {
    expect(classify(row({ pull: merged }))).toBe("cleanup");
  });

  // Merge lands on the forge and leaves the tree alone, and the agent that
  // finished the work is resting in the pane it finished in, so an occupied
  // pane holding merges back would empty the disposition.
  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    { name: "resting", row: held("claude/idle", {}), expected: "merge" },
    { name: "mid-turn", row: held("claude/working", { working: true }), expected: "merge" },
  ])("a green pull request under an agent $name is still a merge", ({ row: subject, expected }) => {
    expect(classify({ ...subject, pull: pull() })).toBe(expected);
  });
});

describe("an agent holding the worktree", () => {
  test.each<{ name: string; row: BoardRow; expected: Disposition }>([
    {
      name: "mid-turn holds back a cleanup",
      row: row({ pull: pull({ state: "merged" }), state: state({ working: true }) }),
      expected: "working",
    },
    {
      name: "mid-turn holds back a report",
      row: row({
        pull: pull({ mergeState: "conflicting" }),
        state: state({ working: true }),
      }),
      expected: "working",
    },
    {
      // The merge lands on the forge, and hiding it would drop the one row the
      // sweep exists to raise.
      name: "mid-turn does not hold back a merge",
      row: row({ pull: pull(), state: state({ working: true }) }),
      expected: "merge",
    },
    {
      name: "finished leaves the row classified by its own state",
      row: row({ pull: pull({ checks: "failing", failing: ["lint"] }) }),
      expected: "needs-you",
    },
  ])("$name", ({ row: subject, expected }) => {
    expect(classify(subject)).toBe(expected);
  });
});

test("the flock's own row and a pane with no worktree bypass the rules", () => {
  expect(classify(row({ state: state({ self: true }) }))).toBe("self");
  expect(classify(row({ kind: "pane", worktree: null }))).toBe("panes");
});

// herdr reports an agent stopped on a prompt as blocked, and that prompt is
// addressed to the user whatever else the row carries.
describe("a blocked agent", () => {
  test("raises a pane that has no worktree to classify by", () => {
    expect(classify(row({ kind: "pane", worktree: null, state: state({ blocked: true }) }))).toBe(
      "needs-you",
    );
  });

  test("outranks a row that would otherwise collapse", () => {
    expect(classify(row({ state: state({ blocked: true, mergedBranch: true }) }))).toBe(
      "needs-you",
    );
  });
});

describe("pullFlags", () => {
  test.each<{ name: string; pull: PullState & { state: string }; expected: string[] }>([
    { name: "a clean green pull request adds nothing", pull: pull(), expected: [] },
    {
      name: "a failing check names its jobs",
      pull: pull({ checks: "failing", failing: ["build", "hooks", "lint"] }),
      expected: ["failing:build,hooks,lint"],
    },
    {
      name: "more failing jobs than fit are counted",
      pull: pull({ checks: "failing", failing: ["a", "b", "c", "d", "e"] }),
      expected: ["failing:a,b,c+2"],
    },
    {
      name: "a long job name is elided rather than widening the column",
      pull: pull({ checks: "failing", failing: ["a-workflow-name-far-past-the-column"] }),
      expected: ["failing:a-workflow-name-far-pas…"],
    },
    {
      name: "a failure with no job names still reports",
      pull: pull({ checks: "failing" }),
      expected: ["failing"],
    },
    {
      // Blocked is usually the failing check restated, and repeating it buries
      // the job name that makes the row actionable.
      name: "a blocked gate is not repeated beside the failure that caused it",
      pull: pull({ checks: "failing", failing: ["lint"], mergeState: "blocked" }),
      expected: ["failing:lint"],
    },
    {
      name: "a blocked gate on a green pull request is reported",
      pull: pull({ mergeState: "blocked" }),
      expected: ["blocked"],
    },
    {
      name: "a conflict is reported beside the failure",
      pull: pull({ checks: "failing", failing: ["lint"], mergeState: "conflicting" }),
      expected: ["failing:lint", "conflicting"],
    },
    { name: "running checks", pull: pull({ checks: "running" }), expected: ["running"] },
    {
      name: "checks the forge would not report",
      pull: pull({ checks: "unknown", mergeState: "unknown" }),
      expected: ["checks:?"],
    },
    {
      name: "an approval and a change request are both worth a flag",
      pull: pull({ review: "approved" }),
      expected: ["approved"],
    },
    {
      name: "changes requested",
      pull: pull({ review: "changes-requested" }),
      expected: ["changes-requested"],
    },
    {
      name: "a merged pull request has no live state",
      pull: pull({ state: "merged" }),
      expected: [],
    },
    {
      name: "a draft's red checks are expected rather than reportable",
      pull: pull({ state: "draft", checks: "failing", failing: ["lint"] }),
      expected: [],
    },
    {
      name: "a pull request with no checks at all says so, rather than reading clean",
      pull: pull({ checks: "none", mergeState: "unknown" }),
      expected: ["checks:none"],
    },
    {
      name: "a gate blocked on checks still running does not restate them",
      pull: pull({ checks: "running", mergeState: "blocked" }),
      expected: ["running"],
    },
    {
      name: "a gate holding a settled green pull request is reported",
      pull: pull({ mergeState: "blocked" }),
      expected: ["blocked"],
    },
  ])("$name", ({ pull: subject, expected }) => {
    expect(pullFlags(subject)).toEqual(expected);
  });
});

describe("the report", () => {
  const board = [
    row({
      branch: "oxlint-type-style",
      pull: pull({ number: 1357, ref: "#1357", checks: "failing", failing: ["lint", "build"] }),
      flags: ["failing:lint,build"],
      disposition: "needs-you",
    }),
    row({
      branch: "dev-worker",
      repoLabel: "bendrucker.me",
      pull: pull({ number: 667, ref: "merged#667", state: "merged" }),
      prColumn: "merged#667",
      flags: ["unpushed:13", "merged"],
      disposition: "needs-you",
    }),
    row({
      branch: "consent-origin-referrer-policy",
      repoLabel: "tailgate",
      pull: pull({ number: 28, ref: "#28", review: "approved" }),
      prColumn: "#28",
      flags: ["approved"],
      disposition: "merge",
    }),
    row({
      branch: "flock-keybind",
      prColumn: "merged#699",
      flags: ["merged"],
      disposition: "cleanup",
    }),
    row({
      branch: "multi-type-unions",
      repoLabel: "oapi-codegen/oapi-codegen",
      ownedByViewer: false,
      pull: pull({ number: 2530, ref: "#2530", review: "review-required" }),
      disposition: "waiting",
    }),
    row({
      branch: "herdr-lazy",
      repoLabel: "dotfiles",
      pull: pull({ number: 700, ref: "#700", checks: "running" }),
      disposition: "waiting",
    }),
    row({
      branch: "remend-perf",
      repoLabel: "vercel/streamdown",
      ownedByViewer: false,
      pull: pull({ number: 571, ref: "#571", review: "approved" }),
      disposition: "waiting",
    }),
    row({ branch: "comments-gate-judge", disposition: "working" }),
    ...["portless", "technical-debt"].map((branch) =>
      row({ branch, repoLabel: "bendrucker.me", disposition: "parked" }),
    ),
    row({ branch: "topo-sort-err", repoLabel: "Homebrew/brew", disposition: "parked" }),
    row({ kind: "pane", pane: "w59:p1", agent: "claude/done", disposition: "panes" }),
  ];
  const groups = groupByDisposition(board);

  test("counts every disposition it rendered or collapsed", () => {
    expect(countLine(groups)).toBe(
      "needs you 2 · merge 1 · clean up 1 · waiting 3 · working 1 · parked 3 · panes 1",
    );
  });

  test("collapses to one line each, keeping the identities worth a follow-up", () => {
    expect(collapsedLines(groups)).toMatchInlineSnapshot(`
[
  "waiting 3: oapi-codegen/oapi-codegen#2530 review · dotfiles#700 ci · vercel/streamdown#571 merge",
  "working 1: claude/comments-gate-judge",
  "parked 3: bendrucker.me 2 · Homebrew/brew 1",
  "panes 1: w59:p1 claude/done",
]
`);
  });

  test("an empty board says so rather than printing a bare header", () => {
    expect(countLine(groupByDisposition([]))).toBe("nothing on the board");
    expect(collapsedLines(groupByDisposition([]))).toEqual([]);
  });
});
