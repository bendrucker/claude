// The contract every queue source emits, one entry per authored PR/MR.
// Platform queues (github-queue.ts here, gitlab's authored-queue.ts) produce
// this shape independently as JSON, so the type is a documented contract, not a
// cross-plugin import. `ci` and `review` use a "none" sentinel rather than null
// so ranking never branches on absence.
export type CiState = "red" | "green" | "pending" | "none";
export type ReviewState = "changes_requested" | "approved" | "review_required" | "none";

export interface ActionEntry {
  url: string;
  platform: "github" | "gitlab";
  ci: CiState;
  review: ReviewState;
  isDraft: boolean;
  updatedAt: string;
}

// Ranked highest-attention first. "none" is the no-action bucket: green, fresh,
// and not waiting on anything you can act on.
export type RankBucket =
  | "red-ci"
  | "changes-requested"
  | "stale-green"
  | "waiting-on-review"
  | "draft"
  | "none";

export const BUCKET_ORDER: RankBucket[] = [
  "red-ci",
  "changes-requested",
  "stale-green",
  "waiting-on-review",
  "draft",
  "none",
];

export interface RankedEntry extends ActionEntry {
  bucket: RankBucket;
}

function isStale(updatedAt: string, now: Date, staleDays: number): boolean {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated >= staleDays * 86_400_000;
}

// Assign the single highest-priority bucket an entry qualifies for. A red CI
// outranks everything else, so a draft or changes-requested PR with failing CI
// still sorts to the top.
export function classify(entry: ActionEntry, now: Date, staleDays: number): RankBucket {
  if (entry.ci === "red") return "red-ci";
  if (entry.review === "changes_requested") return "changes-requested";
  if (entry.ci === "green" && isStale(entry.updatedAt, now, staleDays)) return "stale-green";
  if (entry.review === "review_required") return "waiting-on-review";
  if (entry.isDraft) return "draft";
  return "none";
}

// Rank the combined queue: by bucket priority, then oldest-updated first within
// a bucket so the most-neglected item leads.
export function rankQueue(entries: ActionEntry[], now: Date, staleDays: number): RankedEntry[] {
  return entries
    .map((entry) => ({ ...entry, bucket: classify(entry, now, staleDays) }))
    .sort((a, b) => {
      const order = BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
      if (order !== 0) return order;
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    });
}

// The feed surfaces only entries that need you. "none" is tracked for the
// summary count but excluded from needs-action.md and from babysit dispatch.
export function actionable(ranked: RankedEntry[]): RankedEntry[] {
  return ranked.filter((entry) => entry.bucket !== "none");
}
