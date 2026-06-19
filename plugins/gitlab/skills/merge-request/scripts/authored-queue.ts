#!/usr/bin/env bun

import { $ } from "bun";
import { cli } from "cleye";

export type ReviewState = "UNREVIEWED" | "REVIEW_STARTED" | "REQUESTED_CHANGES" | "APPROVED";

type Reviewer = {
  mergeRequestInteraction: { reviewState: ReviewState | null } | null;
};

type MergeRequestNode = {
  webUrl: string;
  updatedAt: string;
  draft: boolean;
  headPipeline: { status: string | null } | null;
  reviewers: { nodes: Reviewer[] } | null;
};

export type CurrentUser = {
  authoredMergeRequests: { nodes: MergeRequestNode[] };
};

// The contract pull-request:outbox ranks. Defined here independently because
// plugins must not import across the plugin boundary; the shape is the
// documented agreement between gitlab and the outbox feed.
export type CiState = "red" | "green" | "pending" | "none";
export type ReviewVerdict = "changes_requested" | "approved" | "review_required" | "none";
export type AuthoredEntry = {
  url: string;
  platform: "gitlab";
  ci: CiState;
  review: ReviewVerdict;
  isDraft: boolean;
  updatedAt: string;
};

export function mapPipeline(status: string | null | undefined): CiState {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
      return "green";
    case "FAILED":
    case "CANCELED":
      return "red";
    case "":
    case "SKIPPED":
    case "MANUAL":
    case "SCHEDULED":
      return "none";
    default:
      return "pending";
  }
}

// Roll the reviewers' states into one verdict from the author's view: any
// requested-changes outranks an approval, an outstanding reviewer means review
// is still owed, and an MR with no reviewers needs none.
export function mapReviewers(reviewers: Reviewer[]): ReviewVerdict {
  const states = reviewers.map((reviewer) => reviewer.mergeRequestInteraction?.reviewState ?? null);
  if (states.includes("REQUESTED_CHANGES")) return "changes_requested";
  if (states.some((state) => state === "UNREVIEWED" || state === "REVIEW_STARTED")) {
    return "review_required";
  }
  if (states.includes("APPROVED")) return "approved";
  return "none";
}

export function mapMr(node: MergeRequestNode): AuthoredEntry {
  return {
    url: node.webUrl,
    platform: "gitlab",
    ci: mapPipeline(node.headPipeline?.status),
    review: mapReviewers(node.reviewers?.nodes ?? []),
    isDraft: Boolean(node.draft),
    updatedAt: node.updatedAt,
  };
}

const QUERY = `{
  currentUser {
    authoredMergeRequests(state: opened) {
      nodes {
        webUrl
        updatedAt
        draft
        headPipeline {
          status
        }
        reviewers {
          nodes {
            mergeRequestInteraction {
              reviewState
            }
          }
        }
      }
    }
  }
}`;

if (import.meta.main) {
  cli({ name: "authored-queue", flags: {} }, async () => {
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
    console.log(JSON.stringify(currentUser.authoredMergeRequests.nodes.map(mapMr), null, 2));
  });
}
