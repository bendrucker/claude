import { describe, expect, test } from "bun:test";
import {
  branchLabel,
  fit,
  heldByAgent,
  jsonRow,
  renderTable,
  rowCells,
  sortWorktreeRows,
  type BoardRow,
} from "./board";

function row(overrides: Partial<BoardRow>): BoardRow {
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
    state: {
      self: false,
      working: false,
      blocked: false,
      pullUnknown: false,
      status: "clean",
      unpushed: 0,
      carried: 0,
      mergedBranch: false,
      reused: false,
    },
    disposition: "cleanup",
    ...overrides,
  };
}

describe("fit", () => {
  test.each([
    ["short", 9, "short"],
    ["exactly9!", 9, "exactly9!"],
    ["a-very-long-branch-name", 9, "a-very-l…"],
  ])("%s at %i", (value, width, expected) => {
    expect(fit(value, width)).toBe(expected);
  });

  test("an elided value never exceeds the column", () => {
    // oxlint-disable-next-line unicorn/prefer-spread -- typescript/no-misused-spread rejects the spread form on a string.
    expect(Array.from(fit("x".repeat(80), 14))).toHaveLength(14);
  });
});

test("branchLabel marks a detached worktree and blanks a pane row", () => {
  expect(branchLabel(row({ branch: null, detached: true }))).toBe("(detached)");
  expect(branchLabel({ kind: "pane", branch: null, detached: false })).toBe("-");
});

test("the table pads, truncates, and keeps the flags column whole", () => {
  const rendered = renderTable(
    [
      row({
        pane: "wB2:p1",
        agent: "claude/working",
        prColumn: "merged#30366",
        age: 12,
        flags: ["dirty", "carries:2"],
      }),
      row({
        repoLabel: "backnotprop/plannotator",
        repo: "plannotator",
        branch: "a-branch-name-that-will-not-fit-in-the-column",
        ownedByViewer: false,
        age: null,
        flags: ["unreadable"],
      }),
      row({
        kind: "pane",
        pane: "w9W:p1",
        agent: "claude/idle",
        repoLabel: "Herdr",
        branch: null,
        worktree: null,
        age: null,
        prColumn: "-",
        flags: ["no worktree"],
      }),
    ].map(rowCells),
  );

  expect(rendered).toMatchInlineSnapshot(`
"PANE      AGENT          REPO                     BRANCH                     PR            AGE  FLAGS
wB2:p1    claude/working claude                   topic                      merged#30366  12   dirty,carries:2
-         -              backnotprop/plannotator  a-branch-name-that-will-n… -             ?    unreadable
w9W:p1    claude/idle    Herdr                    -                          -             -    no worktree"
`);
});

test("rows sort by repository then branch, with a detached row placed by its label", () => {
  const sorted = sortWorktreeRows([
    row({ repo: "extensions", branch: "zeta" }),
    row({ repo: "claude", branch: "beta" }),
    row({ repo: "claude", branch: null, detached: true }),
    row({ repo: "claude", branch: "alpha" }),
  ]);

  expect(sorted.map((entry) => `${entry.repo}/${branchLabel(entry)}`)).toEqual([
    "claude/(detached)",
    "claude/alpha",
    "claude/beta",
    "extensions/zeta",
  ]);
});

test("a json row carries the fields the table truncates or omits", () => {
  expect(
    jsonRow(
      row({
        pane: "wAW:p1",
        agent: "claude/idle",
        owner: "backnotprop",
        repo: "plannotator",
        slug: "backnotprop/plannotator",
        forkOf: "bendrucker/plannotator",
        ownedByViewer: false,
        repoLabel: "backnotprop/plannotator",
        branch: "doc-containment-gate",
        pull: {
          ref: "#1437",
          number: 1437,
          state: "open",
          checks: "passing",
          failing: [],
          review: "none",
          mergeState: "clean",
        },
        prColumn: "#1437",
        age: 3,
        flags: ["dirty", "carries:1"],
        disposition: "waiting",
        state: {
          self: false,
          working: false,
          blocked: false,
          pullUnknown: false,
          status: "dirty",
          unpushed: 0,
          carried: 1,
          mergedBranch: false,
          reused: false,
        },
      }),
    ),
  ).toEqual({
    kind: "worktree",
    pane: "wAW:p1",
    agent: "claude/idle",
    owner: "backnotprop",
    repo: "plannotator",
    slug: "backnotprop/plannotator",
    forkOf: "bendrucker/plannotator",
    ownedByViewer: false,
    branch: "doc-containment-gate",
    detached: false,
    worktree: "/wt/topic",
    pr: {
      ref: "#1437",
      number: 1437,
      state: "open",
      checks: "passing",
      failing: [],
      review: "none",
      mergeState: "clean",
    },
    prColumn: "#1437",
    age: 3,
    flags: ["dirty", "carries:1"],
    disposition: "waiting",
    state: {
      self: false,
      working: false,
      blocked: false,
      pullUnknown: false,
      status: "dirty",
      unpushed: 0,
      carried: 1,
      mergedBranch: false,
      reused: false,
    },
  });
});

describe("heldByAgent", () => {
  test.each([
    ["a working agent", "claude/working", true],
    ["an agent resting between turns", "claude/idle", true],
    ["an agent whose tab has been seen", "claude/done", true],
    ["an agent stopped on a prompt", "claude/blocked", true],
    ["a status herdr would not report", "claude/?", true],
    ["a person's own shell", "shell/idle", false],
    ["no pane", null, false],
  ] as const)("%s", (_name, agent, expected) => {
    expect(heldByAgent(agent)).toBe(expected);
  });
});
