#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";
import { z } from "zod";

export const ReviewState = z.enum([
  "UNREVIEWED",
  "REVIEW_STARTED",
  "REQUESTED_CHANGES",
  "APPROVED",
]);
export type ReviewState = z.infer<typeof ReviewState>;

const Reviewer = z.looseObject({
  username: z.string(),
  mergeRequestInteraction: z.looseObject({ reviewState: ReviewState.nullable() }).nullish(),
});

const MergeRequestNode = z.looseObject({
  reference: z.string(),
  webUrl: z.string(),
  title: z.string(),
  reviewers: z.looseObject({ nodes: z.array(Reviewer) }).nullish(),
});

export const CurrentUser = z.looseObject({
  username: z.string(),
  reviewRequestedMergeRequests: z.looseObject({ nodes: z.array(MergeRequestNode) }),
});
export type CurrentUser = z.infer<typeof CurrentUser>;

const ReviewQueueResponse = z.looseObject({
  data: z.looseObject({ currentUser: CurrentUser.nullish() }).nullish(),
  errors: z.array(z.looseObject({ message: z.string() })).nullish(),
});

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

if (import.meta.main) {
  cli(
    {
      name: "review-queue",
      flags: {},
    },
    async () => {
      const result = ReviewQueueResponse.parse(await $`glab api graphql -f query=${QUERY}`.json());
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
}
