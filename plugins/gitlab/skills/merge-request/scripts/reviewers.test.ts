import { describe, expect, test } from "bun:test";
import { isBotUsername } from "./reviewers";

describe("isBotUsername", () => {
  test.each([
    "coderabbitai",
    "group_1234_bot",
    "my-reviewer-bot",
    "greptile_bot",
    "Copilot",
  ])("matches bot username %s", (username) => {
    expect(isBotUsername(username)).toBe(true);
  });

  test.each(["bendrucker", "jacob", "robotnik"])("rejects human username %s", (username) => {
    expect(isBotUsername(username)).toBe(false);
  });
});
