import { describe, expect, test } from "claude-code/testing";
import { type CheckNode, type PrView, decide, parseView, snapshotOf, statusOf } from "./pr.ts";

const run = (name: string, status: string, conclusion = "", startedAt = "2026-10-06T10:00:00Z") =>
  ({
    __typename: "CheckRun",
    workflowName: "ci",
    name,
    status,
    conclusion,
    startedAt,
  }) satisfies CheckNode;

const view = (over: Partial<PrView> = {}): PrView => ({
  number: 7,
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  headRefOid: "aaaaaaa1111",
  reviewDecision: "",
  statusCheckRollup: [],
  reviews: [],
  ...over,
});

describe("parseView", () => {
  test("narrows gh output and rejects anything else", () => {
    const parsed = parseView(
      JSON.stringify({
        ...view(),
        statusCheckRollup: [run("lint", "COMPLETED", "SUCCESS"), "junk"],
        reviews: [{ id: "r1", state: "COMMENTED", author: { login: "bot" } }, { id: 3 }],
      }),
    );
    expect(parsed?.statusCheckRollup?.length).toBe(1);
    expect(parsed?.reviews).toEqual([{ id: "r1", state: "COMMENTED", author: { login: "bot" } }]);
    expect(parseView("not json")).toBe(undefined);
    expect(parseView(JSON.stringify({ number: "7" }))).toBe(undefined);
  });
});

describe("snapshotOf", () => {
  test("a rerun replaces the run it reran, and a status context counts", () => {
    const snapshot = snapshotOf(
      view({
        statusCheckRollup: [
          run("test", "COMPLETED", "FAILURE", "2026-10-06T10:00:00Z"),
          run("test", "COMPLETED", "SUCCESS", "2026-10-06T10:05:00Z"),
          run("lint", "COMPLETED", "CANCELLED"),
          { __typename: "StatusContext", context: "deploy", state: "ERROR" },
        ],
      }),
    );
    expect(snapshot.phase).toBe("failing");
    expect(snapshot.failed).toEqual(["deploy"]);
    expect(snapshot.total).toBe(3);
  });

  test("a queued rerun outranks the failure it replaces", () => {
    const snapshot = snapshotOf(
      view({
        statusCheckRollup: [
          run("test", "COMPLETED", "FAILURE"),
          { ...run("test", "QUEUED"), startedAt: null },
        ],
      }),
    );
    expect(snapshot.phase).toBe("pending");
  });
});

describe("decide", () => {
  const pending = snapshotOf(view({ statusCheckRollup: [run("test", "IN_PROGRESS")] }));
  const failing = snapshotOf(view({ statusCheckRollup: [run("test", "COMPLETED", "FAILURE")] }));
  const passing = snapshotOf(view({ statusCheckRollup: [run("test", "COMPLETED", "SUCCESS")] }));

  test("promotes a new failure once per head", () => {
    expect(decide(pending, failing)).toEqual([
      { action: "promote", kind: "ci.failed", failed: ["ci / test"] },
    ]);
    expect(decide(failing, failing)).toEqual([]);
  });

  test("the same failure after a push promotes again", () => {
    const pushed = { ...failing, head: "bbbbbbb2222" };
    expect(decide(failing, pushed)).toEqual([
      { action: "drop", kind: "push", from: "aaaaaaa1111" },
      { action: "promote", kind: "ci.failed", failed: ["ci / test"] },
    ]);
  });

  test("drops green, pending, and closing", () => {
    expect(decide(pending, passing)).toEqual([{ action: "drop", kind: "ci.passing" }]);
    expect(decide(passing, pending)).toEqual([{ action: "drop", kind: "ci.pending" }]);
    expect(decide(passing, { ...passing, state: "MERGED" })).toEqual([
      { action: "drop", kind: "pr.merged" },
    ]);
  });

  test("promotes requested changes and drops other reviews", () => {
    const reviewed = {
      ...passing,
      reviews: [
        { id: "r1", author: "alice", state: "CHANGES_REQUESTED" },
        { id: "r2", author: "greptile", state: "COMMENTED" },
      ],
    };
    expect(decide(passing, reviewed)).toEqual([
      { action: "promote", kind: "review.changes_requested", author: "alice" },
      { action: "drop", kind: "review", author: "greptile", state: "COMMENTED" },
    ]);
    expect(decide(reviewed, reviewed)).toEqual([]);
  });
});

describe("statusOf", () => {
  test("formats each phase", () => {
    const of = (over: Partial<PrView>, flagged = false) =>
      statusOf(snapshotOf(view(over)), flagged);
    expect(
      of({ statusCheckRollup: [run("a", "IN_PROGRESS"), run("b", "COMPLETED", "SUCCESS")] }),
    ).toBe("PR #7 · CI 1/2");
    expect(of({ statusCheckRollup: [run("a", "COMPLETED", "FAILURE")] }, true)).toBe(
      "PR #7 · CI ✗ ci / a → Claude",
    );
    expect(
      of({ statusCheckRollup: [run("a", "COMPLETED", "SUCCESS")], reviewDecision: "APPROVED" }),
    ).toBe("PR #7 · CI ✓ · approved");
    expect(of({ state: "MERGED" })).toBe("PR #7 merged");
  });
});
