import { describe, expect, test } from "bun:test";
import { isBot, isReviewTarget, parseReviewers } from "./reviewers";

describe("isBot", () => {
  test("matches accounts the API typed as Bot", () => {
    expect(isBot({ login: "copilot-pull-request-reviewer", __typename: "Bot" })).toBe(true);
    expect(isBot({ login: "coderabbitai[bot]", __typename: "Bot" })).toBe(true);
  });

  test("rejects accounts typed as User even with a bot-like login", () => {
    expect(isBot({ login: "bendrucker", __typename: "User" })).toBe(false);
    expect(isBot({ login: "coderabbitai", __typename: "User" })).toBe(false);
  });

  test("rejects an author with no typename", () => {
    expect(isBot({ login: "mystery" })).toBe(false);
  });

  test("rejects null", () => {
    expect(isBot(null)).toBe(false);
  });
});

describe("parseReviewers", () => {
  test("reads one login per line, lowercased, ignoring blanks and comments", () => {
    const set = parseReviewers("# extra reviewers\nJacob\n\n  greptileai  # trailing\n");
    expect(set).toEqual(new Set(["jacob", "greptileai"]));
  });
});

describe("isReviewTarget", () => {
  test("includes API bots", () => {
    expect(isReviewTarget({ login: "x", __typename: "Bot" })).toBe(true);
  });

  test("includes listed accounts the API types as User", () => {
    expect(isReviewTarget({ login: "Jacob", __typename: "User" }, new Set(["jacob"]))).toBe(true);
  });

  test("excludes unlisted humans", () => {
    expect(isReviewTarget({ login: "bendrucker", __typename: "User" }, new Set(["jacob"]))).toBe(
      false,
    );
  });

  test("rejects null", () => {
    expect(isReviewTarget(null)).toBe(false);
  });
});
