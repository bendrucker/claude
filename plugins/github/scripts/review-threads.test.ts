import { describe, expect, test } from "bun:test";
import {
  REACT_MUTATION,
  REPLY_MUTATION,
  RESOLVE_MUTATION,
  THREAD_COMMENT_QUERY,
} from "./review-threads";

describe("mutations", () => {
  test.each<[string, string, string[]]>([
    [
      "reply targets the review thread and posts a body",
      REPLY_MUTATION,
      ["addPullRequestReviewThreadReply", "pullRequestReviewThreadId: $threadId", "body: $body"],
    ],
    [
      "resolve targets the review thread",
      RESOLVE_MUTATION,
      ["resolveReviewThread", "threadId: $threadId"],
    ],
    [
      "react adds a reaction to a subject",
      REACT_MUTATION,
      ["addReaction", "subjectId: $subjectId", "content: $content"],
    ],
    [
      "thread comment query reads the first comment of a thread",
      THREAD_COMMENT_QUERY,
      ["PullRequestReviewThread", "comments(first: 1)"],
    ],
  ])("%s", (_name, constant, substrings) => {
    for (const substring of substrings) {
      expect(constant).toContain(substring);
    }
  });
});
