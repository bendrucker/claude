import { describe, expect, test } from "bun:test";
import {
  assertComplete,
  type CurrentUser,
  filterReviewQueue,
  QUERY,
  type ReviewState,
} from "./review-queue";

function mrNode(
  reference: string,
  reviewers: { username: string; reviewState: ReviewState | null }[],
) {
  return {
    reference,
    webUrl: `https://gitlab.com/org/proj/-/merge_requests/${reference.replace(/^.*!/, "")}`,
    title: `Title for ${reference}`,
    reviewers: {
      nodes: reviewers.map((r) => ({
        username: r.username,
        mergeRequestInteraction: r.reviewState === null ? null : { reviewState: r.reviewState },
      })),
    },
  };
}

function currentUser(nodes: ReturnType<typeof mrNode>[]): CurrentUser {
  return {
    username: "me",
    reviewRequestedMergeRequests: { nodes },
  };
}

describe("filterReviewQueue", () => {
  test("keeps MRs where my reviewer entry is UNREVIEWED", () => {
    const result = filterReviewQueue(
      currentUser([mrNode("org/proj!1", [{ username: "me", reviewState: "UNREVIEWED" }])]),
    );

    expect(result).toEqual([
      {
        url: "https://gitlab.com/org/proj/-/merge_requests/1",
        reference: "org/proj!1",
        title: "Title for org/proj!1",
      },
    ]);
  });

  test.each<ReviewState>(["APPROVED", "REQUESTED_CHANGES", "REVIEW_STARTED"])(
    "drops MRs where my reviewer entry is %s",
    (reviewState) => {
      const result = filterReviewQueue(
        currentUser([mrNode("org/proj!2", [{ username: "me", reviewState }])]),
      );

      expect(result).toEqual([]);
    },
  );

  test("ignores other reviewers' states", () => {
    const result = filterReviewQueue(
      currentUser([
        mrNode("org/proj!3", [
          { username: "someone", reviewState: "UNREVIEWED" },
          { username: "me", reviewState: "APPROVED" },
        ]),
      ]),
    );

    expect(result).toEqual([]);
  });

  test("keeps MR when I am UNREVIEWED even if another reviewer approved", () => {
    const result = filterReviewQueue(
      currentUser([
        mrNode("org/proj!4", [
          { username: "someone", reviewState: "APPROVED" },
          { username: "me", reviewState: "UNREVIEWED" },
        ]),
      ]),
    );

    expect(result.map((r) => r.reference)).toEqual(["org/proj!4"]);
  });

  test("drops MRs where I am not a reviewer", () => {
    const result = filterReviewQueue(
      currentUser([mrNode("org/proj!5", [{ username: "someone", reviewState: "UNREVIEWED" }])]),
    );

    expect(result).toEqual([]);
  });

  test("drops MRs where my interaction is missing", () => {
    const result = filterReviewQueue(
      currentUser([mrNode("org/proj!6", [{ username: "me", reviewState: null }])]),
    );

    expect(result).toEqual([]);
  });

  test("returns empty for an empty queue", () => {
    expect(filterReviewQueue(currentUser([]))).toEqual([]);
  });

  test("tolerates a null reviewers connection without throwing", () => {
    const user: CurrentUser = {
      username: "me",
      reviewRequestedMergeRequests: {
        nodes: [
          {
            reference: "org/proj!7",
            webUrl: "https://gitlab.com/org/proj/-/merge_requests/7",
            title: "no reviewers",
            reviewers: null,
          },
        ],
      },
    };

    expect(filterReviewQueue(user)).toEqual([]);
  });
});

describe("QUERY", () => {
  test("asks for the project-qualified reference, which !iid alone is not", () => {
    expect(QUERY).toContain("reference(full: true)");
  });
});

describe("assertComplete", () => {
  const withPage = (hasNextPage: boolean | undefined): CurrentUser => ({
    username: "me",
    reviewRequestedMergeRequests: {
      nodes: [],
      pageInfo: hasNextPage === undefined ? null : { hasNextPage },
    },
  });

  test("throws when another page exists", () => {
    expect(() => {
      assertComplete(withPage(true));
    }).toThrow("truncated");
  });

  test.each([false, undefined])("passes when hasNextPage is %p", (hasNextPage) => {
    expect(() => {
      assertComplete(withPage(hasNextPage));
    }).not.toThrow();
  });
});

describe("filterReviewQueue across projects", () => {
  test("keeps same-iid MRs from different projects apart", () => {
    const result = filterReviewQueue(
      currentUser([
        mrNode("org/a!1", [{ username: "me", reviewState: "UNREVIEWED" }]),
        mrNode("org/b!1", [{ username: "me", reviewState: "UNREVIEWED" }]),
      ]),
    );

    expect(result.map((r) => r.reference)).toEqual(["org/a!1", "org/b!1"]);
  });
});
