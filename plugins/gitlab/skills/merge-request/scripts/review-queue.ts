#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";

export type ReviewState = "UNREVIEWED" | "REVIEW_STARTED" | "REQUESTED_CHANGES" | "APPROVED";

type Reviewer = {
  username: string;
  mergeRequestInteraction: { reviewState: ReviewState | null } | null;
};

type MergeRequestNode = {
  reference: string;
  webUrl: string;
  title: string;
  reviewers: { nodes: Reviewer[] } | null;
};

export type CurrentUser = {
  username: string;
  reviewRequestedMergeRequests: { nodes: MergeRequestNode[] };
};

export type ReviewQueueEntry = { url: string; reference: string; title: string };

const QUERY = `{
  currentUser {
    username
    reviewRequestedMergeRequests(state: opened) {
      nodes {
        reference
        webUrl
        title
        reviewers {
          nodes {
            username
            mergeRequestInteraction {
              reviewState
            }
          }
        }
      }
    }
  }
}`;

// Keep MRs where the current user's own reviewer entry is still UNREVIEWED:
// MRs awaiting my first review. Other reviewers' states are ignored, and an MR
// I have already approved, sent back, or started is dropped.
export function filterReviewQueue(currentUser: CurrentUser): ReviewQueueEntry[] {
  const { username } = currentUser;
  return currentUser.reviewRequestedMergeRequests.nodes
    .filter((node) =>
      (node.reviewers?.nodes ?? []).some(
        (reviewer) =>
          reviewer.username === username &&
          reviewer.mergeRequestInteraction?.reviewState === "UNREVIEWED",
      ),
    )
    .map((node) => ({ url: node.webUrl, reference: node.reference, title: node.title }));
}

cli(
  {
    name: "review-queue",
    flags: {},
  },
  async () => {
    const result = (await $`glab api graphql -f query=${QUERY}`.json()) as {
      data?: { currentUser?: CurrentUser | null };
      errors?: Array<{ message: string }>;
    };
    if (result.errors?.length) {
      console.error(`GraphQL errors: ${result.errors.map((e) => e.message).join("; ")}`);
      process.exit(1);
    }
    const currentUser = result.data?.currentUser;
    if (!currentUser) {
      console.error("No currentUser in GraphQL response (is glab authenticated?)");
      process.exit(1);
    }
    console.log(JSON.stringify(filterReviewQueue(currentUser), null, 2));
  },
);
