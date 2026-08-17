import { describe, expect, test } from "bun:test";
import { isBotUsername, isReviewTarget, parseReviewers } from "./reviewers";

describe("isBotUsername", () => {
  test.each([
    "group_1234_bot",
    "group_108656794_bot_52b7e4c7a732080fa3b51efe36863e09",
    "project_42_bot_abc123def456",
    "my-reviewer-bot",
    "greptile_bot",
    "Project-Bot",
  ])("matches the %s service-account convention", (username) => {
    expect(isBotUsername(username)).toBe(true);
  });

  test.each(["bendrucker", "jacob", "coderabbitai", "robotnik", "group_bot_user", "my_bot_friend"])(
    "rejects %s (no bot suffix)",
    (username) => {
      expect(isBotUsername(username)).toBe(false);
    },
  );
});

describe("parseReviewers", () => {
  test("reads one username per line, lowercased, ignoring blanks and comments", () => {
    expect(parseReviewers("# bots\nCodeRabbitAI\n\n jacob # human \n")).toEqual(
      new Set(["coderabbitai", "jacob"]),
    );
  });
});

describe("isReviewTarget", () => {
  test("includes structural bot accounts", () => {
    expect(isReviewTarget("group_9_bot")).toBe(true);
  });

  test("includes listed usernames that break the convention", () => {
    expect(isReviewTarget("coderabbitai", new Set(["coderabbitai"]))).toBe(true);
    expect(isReviewTarget("jacob", new Set(["jacob"]))).toBe(true);
  });

  test("excludes unlisted humans", () => {
    expect(isReviewTarget("bendrucker", new Set(["jacob"]))).toBe(false);
  });
});
