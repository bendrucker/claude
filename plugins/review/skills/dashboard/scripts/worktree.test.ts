import { describe, expect, test } from "bun:test";
import { findReviewWorktree, type WtWorktree } from "./worktree";

const WORKTREES: WtWorktree[] = [
  { branch: "main", path: "/Users/ben/src/acme" },
  {
    branch: "worktree-review-acme-widgets-99",
    path: "/Users/ben/src/acme/.worktrees/worktree-review-acme-widgets-99",
  },
  { branch: "some-feature", path: "/Users/ben/src/acme.some-feature" },
];

describe("findReviewWorktree", () => {
  test("matches the worktree whose branch contains the paneName", () => {
    expect(findReviewWorktree(WORKTREES, "review-acme-widgets-99")).toEqual({
      branch: "worktree-review-acme-widgets-99",
      path: "/Users/ben/src/acme/.worktrees/worktree-review-acme-widgets-99",
    });
  });

  test("matches by path when the branch does not carry the paneName", () => {
    const worktrees: WtWorktree[] = [
      { branch: null, path: "/Users/ben/src/acme/.worktrees/review-acme-widgets-7" },
    ];

    expect(findReviewWorktree(worktrees, "review-acme-widgets-7")).toEqual(worktrees[0]);
  });

  test("returns undefined when no worktree carries the paneName", () => {
    expect(findReviewWorktree(WORKTREES, "review-other-org-1")).toBeUndefined();
  });

  test("does not match a PR number that is a prefix of another (9 vs 99)", () => {
    expect(findReviewWorktree(WORKTREES, "review-acme-widgets-9")).toBeUndefined();
  });
});
