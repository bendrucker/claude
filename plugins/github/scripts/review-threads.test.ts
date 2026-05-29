import { describe, expect, test } from "bun:test";
import { REPLY_MUTATION, RESOLVE_MUTATION } from "./review-threads";

describe("mutations", () => {
  test("reply targets the review thread and posts a body", () => {
    expect(REPLY_MUTATION).toContain("addPullRequestReviewThreadReply");
    expect(REPLY_MUTATION).toContain("pullRequestReviewThreadId: $threadId");
    expect(REPLY_MUTATION).toContain("body: $body");
  });

  test("resolve targets the review thread", () => {
    expect(RESOLVE_MUTATION).toContain("resolveReviewThread");
    expect(RESOLVE_MUTATION).toContain("threadId: $threadId");
  });
});
