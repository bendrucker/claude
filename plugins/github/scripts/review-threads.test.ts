import { describe, expect, test } from "bun:test";
import {
  REACT_MUTATION,
  REPLY_MUTATION,
  RESOLVE_MUTATION,
  THREAD_COMMENT_QUERY,
} from "./review-threads";

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

  test("react adds a reaction to a subject", () => {
    expect(REACT_MUTATION).toContain("addReaction");
    expect(REACT_MUTATION).toContain("subjectId: $subjectId");
    expect(REACT_MUTATION).toContain("content: $content");
  });

  test("thread comment query reads the first comment of a thread", () => {
    expect(THREAD_COMMENT_QUERY).toContain("PullRequestReviewThread");
    expect(THREAD_COMMENT_QUERY).toContain("comments(first: 1)");
  });
});
