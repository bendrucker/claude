import { describe, expect, test } from "bun:test";
import { derivePaneName, deriveRepo } from "./parse";

describe("deriveRepo", () => {
  test.each<[string, string]>([
    ["https://github.com/owner/repo/pull/42", "owner/repo"],
    ["https://gitlab.com/group/repo/-/merge_requests/1", "group/repo"],
  ])("%s -> %s", (url, expected) => {
    expect(deriveRepo(url)).toBe(expected);
  });
});

describe("derivePaneName", () => {
  test.each<[string, string]>([
    ["https://github.com/owner/repo/pull/42", "review-owner-repo-42"],
    ["https://gitlab.com/group/repo/-/merge_requests/7", "review-group-repo-7"],
  ])("%s -> %s", (url, expected) => {
    expect(derivePaneName(url)).toBe(expected);
  });
});
