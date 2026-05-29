import { describe, expect, test } from "bun:test";
import { isBot, isBotLogin } from "./reviewers";

describe("isBotLogin", () => {
  test.each([
    "coderabbitai",
    "coderabbitai[bot]",
    "copilot-pull-request-reviewer",
    "github-copilot[bot]",
    "greptile-apps[bot]",
    "greptileai",
    "Greptile-Apps", // case-insensitive
  ])("matches bot login %s", (login) => {
    expect(isBotLogin(login)).toBe(true);
  });

  test.each(["bendrucker", "octocat", "dependabot"])("rejects human login %s", (login) => {
    expect(isBotLogin(login)).toBe(false);
  });
});

describe("isBot", () => {
  test("matches on __typename Bot even when login is unlisted", () => {
    expect(isBot({ login: "some-new-reviewer", __typename: "Bot" })).toBe(true);
  });

  test("matches a listed App surfaced as User", () => {
    expect(isBot({ login: "coderabbitai[bot]", __typename: "User" })).toBe(true);
  });

  test("rejects a human User", () => {
    expect(isBot({ login: "bendrucker", __typename: "User" })).toBe(false);
  });

  test("rejects null", () => {
    expect(isBot(null)).toBe(false);
  });
});
