/** A frozen climb PR under `seeds/<name>/`. */
export interface Seed {
  pr: number;
  /** Commit date for the scaffolded base and head, so SHAs repeat across runs. */
  date: string;
}

export const SEEDS: Record<string, Seed> = {
  "show-me-stop": { pr: 1506, date: "2026-09-24T03:45:00Z" },
  "tdd-adapter": { pr: 1509, date: "2026-09-24T03:50:00Z" },
  "tdd-readback": { pr: 1510, date: "2026-09-24T03:54:00Z" },
  "show-me-scoped": { pr: 1520, date: "2026-09-24T15:55:00Z" },
};

export type Plant =
  | "none"
  | "noise"
  | "drift"
  | "leakage"
  | "grader-edit"
  | "unregistered"
  | "holdout-fell"
  | "versions";

export interface CaseSpec {
  name: string;
  seed: keyof typeof SEEDS;
  plant: Plant;
  split: "dev" | "holdout";
  verdict: "holds" | "fails";
  /** What a reply must name for the judge to pass it, or undefined on a clean case. */
  flaw?: string;
}

export const CASES: CaseSpec[] = [
  { name: "stop-clean", seed: "show-me-stop", plant: "none", split: "dev", verdict: "holds" },
  {
    name: "stop-noise",
    seed: "show-me-stop",
    plant: "noise",
    split: "dev",
    verdict: "fails",
    flaw: "the two baseline replicates disagree with each other by about as much as the claimed gain, so the gain sits inside run-to-run noise",
  },
  {
    name: "stop-drift",
    seed: "show-me-stop",
    plant: "drift",
    split: "dev",
    verdict: "fails",
    flaw: "the without arm, which never loads the skill, rose in the candidate runs about as much as the with arm, contradicting the body's claim that it held flat",
  },
  {
    name: "stop-leakage",
    seed: "show-me-stop",
    plant: "leakage",
    split: "dev",
    verdict: "fails",
    flaw: "the added skill text names details of the `price-cache` holdout case (a price cache, invalidating one SKU), so the holdout no longer tests unseen cases",
  },
  {
    name: "stop-grader-edit",
    seed: "show-me-stop",
    plant: "grader-edit",
    split: "dev",
    verdict: "fails",
    flaw: "the PR loosens the `short-close` grader, the one its own target is measured by, by raising its character threshold from 500 to 1500",
  },
  {
    name: "stop-unregistered",
    seed: "show-me-stop",
    plant: "unregistered",
    split: "dev",
    verdict: "fails",
    flaw: "the body states no target or guards before its result, so its starred rows were chosen after the fact",
  },
  {
    name: "stop-holdout-fell",
    seed: "show-me-stop",
    plant: "holdout-fell",
    split: "dev",
    verdict: "fails",
    flaw: "the holdout candidate runs show the with arm falling, contradicting the body's holdout claim of 0.90 to 0.92",
  },
  {
    name: "stop-versions",
    seed: "show-me-stop",
    plant: "versions",
    split: "dev",
    verdict: "fails",
    flaw: "the candidate runs used a different Claude Code version and model than the baseline runs, with no re-baseline",
  },
  {
    name: "tdd-adapter",
    seed: "tdd-adapter",
    plant: "none",
    split: "holdout",
    verdict: "fails",
    flaw: "at least one of: the holdout never ran; the guard rows on the other dev cases rest on two runs a side, too few to show a regression; the new rule names the weather case's specifics, such as a global `fetch`",
  },
  {
    name: "tdd-readback",
    seed: "tdd-readback",
    plant: "none",
    split: "holdout",
    verdict: "fails",
    flaw: "at least one of: the holdout never ran; the other dev cases ran once on the candidate, so the guard check rests on case minimums from single runs",
  },
  {
    name: "show-me-scoped",
    seed: "show-me-scoped",
    plant: "none",
    split: "holdout",
    verdict: "fails",
    flaw: "at least one of: the holdout has not run; the top-up to eight runs covered only the two cases in question, so the star came from adding runs where a result was wanted; `design-order` slipped on plan order and grew longer",
  },
];
