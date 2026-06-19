import { describe, expect, test } from "bun:test";
import { derivePaneName, deriveRepo } from "./parse";

describe("deriveRepo", () => {
  test("extracts owner/repo from GitHub PR URL", () => {
    expect(deriveRepo("https://github.com/owner/repo/pull/42")).toBe("owner/repo");
  });

  test("extracts group/repo from GitLab MR URL", () => {
    expect(deriveRepo("https://gitlab.com/group/repo/-/merge_requests/1")).toBe("group/repo");
  });
});

describe("derivePaneName", () => {
  test("GitHub PR URL", () => {
    expect(derivePaneName("https://github.com/owner/repo/pull/42")).toBe("review-owner-repo-42");
  });

  test("GitLab MR URL", () => {
    expect(derivePaneName("https://gitlab.com/group/repo/-/merge_requests/7")).toBe(
      "review-group-repo-7",
    );
  });
});
