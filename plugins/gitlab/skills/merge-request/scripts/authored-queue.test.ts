import { describe, expect, test } from "bun:test";
import { mapMr, mapPipeline, mapReviewers } from "./authored-queue";

describe("mapPipeline", () => {
  test.each([
    ["SUCCESS", "green"],
    ["FAILED", "red"],
    ["CANCELED", "red"],
    ["RUNNING", "pending"],
    ["PENDING", "pending"],
    ["SKIPPED", "none"],
    ["MANUAL", "none"],
    [null, "none"],
  ] as const)("%s -> %s", (status, expected) => {
    expect(mapPipeline(status)).toBe(expected);
  });
});

describe("mapReviewers", () => {
  test.each([
    ["no reviewers", [], "none"],
    ["requested changes outranks approval", ["REQUESTED_CHANGES", "APPROVED"], "changes_requested"],
    ["an outstanding reviewer owes review", ["APPROVED", "UNREVIEWED"], "review_required"],
    ["review started still owes review", ["REVIEW_STARTED"], "review_required"],
    ["all approved", ["APPROVED", "APPROVED"], "approved"],
  ] as const)("%s", (_label, states, expected) => {
    const reviewers = states.map((reviewState) => ({ mergeRequestInteraction: { reviewState } }));
    expect(mapReviewers(reviewers)).toBe(expected);
  });
});

describe("mapMr", () => {
  test("projects an authored MR node onto the ActionEntry contract", () => {
    expect(
      mapMr({
        webUrl: "https://gitlab.com/o/r/-/merge_requests/3",
        updatedAt: "2026-06-17T00:00:00Z",
        draft: true,
        headPipeline: { status: "FAILED" },
        reviewers: { nodes: [{ mergeRequestInteraction: { reviewState: "UNREVIEWED" } }] },
      }),
    ).toEqual({
      url: "https://gitlab.com/o/r/-/merge_requests/3",
      platform: "gitlab",
      ci: "red",
      review: "review_required",
      isDraft: true,
      updatedAt: "2026-06-17T00:00:00Z",
    });
  });
});
