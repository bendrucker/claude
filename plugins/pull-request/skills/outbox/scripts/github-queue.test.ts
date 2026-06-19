import { describe, expect, test } from "bun:test";
import { mapPr, mapReview, rollupCi } from "./github-queue";

describe("rollupCi", () => {
  test.each([
    ["no checks", [], "none"],
    ["all success check runs", [{ status: "COMPLETED", conclusion: "SUCCESS" }], "green"],
    [
      "neutral and skipped count as green",
      [
        { status: "COMPLETED", conclusion: "NEUTRAL" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
      ],
      "green",
    ],
    [
      "a failure makes it red",
      [
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "FAILURE" },
      ],
      "red",
    ],
    ["timed-out is red", [{ status: "COMPLETED", conclusion: "TIMED_OUT" }], "red"],
    [
      "in-progress with no failure is pending",
      [
        { status: "IN_PROGRESS", conclusion: null },
        { status: "COMPLETED", conclusion: "SUCCESS" },
      ],
      "pending",
    ],
    [
      "failure outranks pending",
      [{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }],
      "red",
    ],
    ["legacy status context success", [{ state: "SUCCESS" }], "green"],
    ["legacy status context pending", [{ state: "PENDING" }], "pending"],
    ["legacy status context error is red", [{ state: "ERROR" }], "red"],
  ] as const)("%s", (_label, rollup, expected) => {
    expect(rollupCi([...rollup])).toBe(expected);
  });
});

describe("mapReview", () => {
  test.each([
    ["CHANGES_REQUESTED", "changes_requested"],
    ["APPROVED", "approved"],
    ["REVIEW_REQUIRED", "review_required"],
    ["", "none"],
    [null, "none"],
  ] as const)("%s -> %s", (decision, expected) => {
    expect(mapReview(decision)).toBe(expected);
  });
});

describe("mapPr", () => {
  test("projects a gh pr view payload onto the ActionEntry contract", () => {
    expect(
      mapPr({
        url: "https://github.com/o/r/pull/7",
        statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
        reviewDecision: "REVIEW_REQUIRED",
        isDraft: true,
        updatedAt: "2026-06-18T00:00:00Z",
      }),
    ).toEqual({
      url: "https://github.com/o/r/pull/7",
      platform: "github",
      ci: "red",
      review: "review_required",
      isDraft: true,
      updatedAt: "2026-06-18T00:00:00Z",
    });
  });
});
