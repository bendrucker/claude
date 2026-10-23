export type Split = "dev" | "holdout";
export type Brief = "skill" | "agent" | "rule" | "quiet" | "removal" | "extend" | "pydantic";

export interface CaseSpec {
  name: string;
  split: Split;
  brief: Brief;
  /** Kinds of request the brief names, each of which needs a case in every split in `splits`. */
  kinds: string[];
  /** Splits a kind must appear in: `extend` starts with every kind in `dev`. */
  splits: Split[];
  /** The harness the session writes: `pydantic` swaps `case.yaml` files for a `Dataset`. */
  harness: "native" | "pydantic";
  /** A regex for the fact a removal must leave in place, on a `removal` brief. */
  fact?: string;
  /** The miss an ad hoc suite hit that the brief turns into a trap. */
  seed: string;
}

/** The hand-written `prompt.md` and `fixture.sh` of each case sit beside the files the generator writes. */
export const CASES: CaseSpec[] = [
  {
    name: "skill-changelog",
    split: "dev",
    brief: "skill",
    kinds: ["fix", "breaking"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "a suite of nine cases with no holdout tag, so no later edit could be checked against unseen cases",
  },
  {
    name: "skill-branch-name",
    split: "holdout",
    brief: "skill",
    kinds: ["ticket", "freeform"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "a claim pattern that failed a reply for naming the cause it ruled out",
  },
  {
    name: "agent-dep-review",
    split: "dev",
    brief: "agent",
    kinds: ["bump", "added"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "a judge set to the model under test, so both shared one blind spot",
  },
  {
    name: "agent-ticket-triage",
    split: "holdout",
    brief: "agent",
    kinds: ["bug", "question"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "a trace pattern anchored on one key order of a serialized tool input",
  },
  {
    name: "rule-sql-style",
    split: "dev",
    brief: "rule",
    kinds: ["select", "migration"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "expected values copied into the fixture the session ran in, where a Grep found them",
  },
  {
    name: "quiet-commit-scope",
    split: "dev",
    brief: "quiet",
    kinds: ["scope", "amend"],
    splits: ["dev", "holdout"],
    harness: "native",
    seed: "a skill that fired on every git request because no case asked it to stay quiet",
  },
  {
    name: "removal-error-copy",
    split: "holdout",
    brief: "removal",
    kinds: ["rewrite", "fresh"],
    splits: ["dev", "holdout"],
    harness: "native",
    fact: "E-|error code",
    seed: "a removal grader with no survival partner, which an empty reply passed",
  },
  {
    name: "extend-rollback-note",
    split: "dev",
    brief: "extend",
    kinds: ["rollback", "hotfix"],
    splits: ["holdout"],
    harness: "native",
    seed: "a review suite of four cases with no holdout, grown by adding more dev cases",
  },
  {
    name: "pydantic-support-agent",
    split: "dev",
    brief: "pydantic",
    kinds: ["refund", "shipping"],
    splits: ["dev", "holdout"],
    harness: "pydantic",
    seed: "a pydantic-evals report that an earlier climb read through native-only commands",
  },
];

/** The kinds a good session tags in addition to the request kinds the brief names. */
export const ROLES = ["quiet", "balance"] as const;
