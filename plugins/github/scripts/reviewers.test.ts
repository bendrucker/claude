import { describe, expect, test } from "bun:test";
import { type Author, isBot, isReviewTarget, parseReviewers } from "./reviewers";

describe("isBot", () => {
  test.each<[Author | null, boolean]>([
    [{ login: "copilot-pull-request-reviewer", __typename: "Bot" }, true],
    [{ login: "coderabbitai[bot]", __typename: "Bot" }, true],
    [{ login: "bendrucker", __typename: "User" }, false],
    [{ login: "coderabbitai", __typename: "User" }, false],
    [{ login: "mystery" }, false],
    [null, false],
  ])("isBot(%p) -> %p", (account, expected) => {
    expect(isBot(account)).toBe(expected);
  });
});

describe("parseReviewers", () => {
  test("reads one login per line, lowercased, ignoring blanks and comments", () => {
    const set = parseReviewers("# extra reviewers\nJacob\n\n  greptileai  # trailing\n");
    expect(set).toEqual(new Set(["jacob", "greptileai"]));
  });
});

describe("isReviewTarget", () => {
  test.each<[Author | null, Set<string> | undefined, boolean]>([
    [{ login: "x", __typename: "Bot" }, undefined, true],
    [{ login: "Jacob", __typename: "User" }, new Set(["jacob"]), true],
    [{ login: "bendrucker", __typename: "User" }, new Set(["jacob"]), false],
    [null, undefined, false],
  ])("isReviewTarget(%p, %p) -> %p", (account, set, expected) => {
    expect(isReviewTarget(account, set)).toBe(expected);
  });
});
