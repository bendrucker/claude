#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: shells out to gh for TLS-bearing GitHub API calls

import { $ } from "bun";
import { cli } from "cleye";
import type { ActionEntry, CiState, ReviewState } from "./rank";

// One element of gh's statusCheckRollup: a CheckRun carries status/conclusion,
// a legacy StatusContext carries state. We normalize both.
type RollupItem = {
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
};

type PrView = {
  url: string;
  statusCheckRollup?: RollupItem[] | null;
  reviewDecision?: string | null;
  isDraft?: boolean | null;
  updatedAt: string;
};

function itemState(item: RollupItem): "red" | "green" | "pending" {
  if (item.state) {
    const state = item.state.toUpperCase();
    if (state === "SUCCESS") return "green";
    if (state === "PENDING" || state === "EXPECTED") return "pending";
    return "red";
  }
  const status = (item.status ?? "").toUpperCase();
  if (status !== "COMPLETED") return "pending";
  const conclusion = (item.conclusion ?? "").toUpperCase();
  if (conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED") {
    return "green";
  }
  return "red";
}

// Roll the per-check states into one CI verdict: any failure is red, otherwise
// any in-flight check is pending, otherwise green. No checks at all is "none".
export function rollupCi(rollup: RollupItem[]): CiState {
  if (!rollup.length) return "none";
  const states = rollup.map(itemState);
  if (states.includes("red")) return "red";
  if (states.includes("pending")) return "pending";
  return "green";
}

export function mapReview(decision: string | null | undefined): ReviewState {
  switch ((decision ?? "").toUpperCase()) {
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "APPROVED":
      return "approved";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

export function mapPr(view: PrView): ActionEntry {
  return {
    url: view.url,
    platform: "github",
    ci: rollupCi(view.statusCheckRollup ?? []),
    review: mapReview(view.reviewDecision),
    isDraft: Boolean(view.isDraft),
    updatedAt: view.updatedAt,
  };
}

if (import.meta.main) {
  cli({ name: "github-queue", flags: {} }, async () => {
    const found = (await $`gh search prs --author=@me --state=open --json url`.json()) as {
      url: string;
    }[];
    const entries = await Promise.all(
      found.map(async ({ url }) => {
        const view =
          (await $`gh pr view ${url} --json url,statusCheckRollup,reviewDecision,isDraft,updatedAt`.json()) as PrView;
        return mapPr(view);
      }),
    );
    console.log(JSON.stringify(entries, null, 2));
  });
}
