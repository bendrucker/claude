import type { CriterionKey } from "./judge";

/**
 * Reproducibility tuples for the meaning-layer judge (issue #791): committed
 * (prompt hash, input hash, expected flags) over synthetic negatives and
 * invented positives at temperature 0. Every text is invented; none is quoted
 * from any session corpus, so the file is safe to commit.
 *
 * Two consumers:
 *
 * - `judge-fixtures.test.ts` (CI, no API key): asserts each `inputSha256`
 *   matches its text and `JUDGE_PROMPT_SHA256` matches the committed
 *   `resources/judge/prompt.md`, so a prompt or fixture edit cannot land
 *   without re-pinning the tuples.
 * - `judge-run.ts --gate` (local, API key required): replays each tuple
 *   against the live judge and fails on any expectation mismatch. The gate is
 *   drift detection at measurement time, not a per-commit block, so it is not
 *   wired into default CI.
 *
 * GATE STATUS: the expectations below are design targets pending the first
 * live gate run, which is part of the #791 calibration checkpoint (a user
 * decision). Until that run, treat them as unvalidated.
 */

/** Pinned hash of resources/judge/prompt.md. A prompt edit must update this. */
export const JUDGE_PROMPT_SHA256 =
  "312c99b19d6a689deb762bea1a71c470a4362758dbda345c9471b918d479af52";

/** Pinned hash of resources/judge/headings-prompt.md (#769 reference baseline). */
export const HEADINGS_PROMPT_SHA256 =
  "7f05ca8b8eecf96d574c487f7dda45f2800a1c757d50aed3091454a36e295c8c";

export interface JudgeFixture {
  id: string;
  kind: "invented-positive" | "synthetic-negative";
  text: string;
  /** sha256 of `text`; the CI test recomputes and compares. */
  inputSha256: string;
  /**
   * Committed expectations. Negatives pin all six criteria false; positives
   * pin only their target criterion true, because a strongly slopful text may
   * legitimately trip neighboring criteria and pinning those would make the
   * gate brittle.
   */
  expect: Partial<Record<CriterionKey, boolean>>;
}

const ALL_CLEAN: Record<CriterionKey, boolean> = {
  information_density: false,
  motivation_presence: false,
  marketing_phrasing: false,
  hedging_density: false,
  sycophancy: false,
  press_release_structure: false,
};

export const JUDGE_FIXTURES: readonly JudgeFixture[] = [
  {
    id: "negative-mechanism-first",
    kind: "synthetic-negative",
    text: "The session index dropped rows when two hosts shared a session id, because the merge keyed on session_id alone. Keying on (host, session_id) preserves both copies. The cost is a wider primary key, which grows the index by about 4% on the current corpus.",
    inputSha256: "c2a2ef0c20763862c84bc5402edda8f7bb5ee4a8cd4adbb101ee60001b8e8ae0",
    expect: ALL_CLEAN,
  },
  {
    id: "negative-tradeoff-stated",
    kind: "synthetic-negative",
    text: "Cap the retry queue at 1,000 entries. Unbounded growth during the May incident exhausted the broker's memory; dropping the oldest entry under pressure trades replay completeness for liveness.",
    inputSha256: "a94d0a78422dbca1b09dab755e6da7ca898bcda840253bb9400f5d6ed5d509a7",
    expect: ALL_CLEAN,
  },
  {
    id: "positive-information-density",
    kind: "invented-positive",
    text: "This PR updates the validation logic in three files and adds two new test cases. All 12 tests pass. These changes ensure the validator behaves correctly for every supported input.",
    inputSha256: "4e2c6c54b4128926707eb6d521d8e56081423248ac7c0b0dab8d54043d320ef1",
    expect: { information_density: true },
  },
  {
    id: "positive-motivation-presence",
    kind: "invented-positive",
    text: "Renamed the Config struct to Settings and moved it into its own module. Updated imports across the codebase and regenerated the mocks.",
    inputSha256: "e824d5d4b5030d4d615a16cc8960c787c0e328609adeae7cb9299bc5072453c8",
    expect: { motivation_presence: true },
  },
  {
    id: "positive-marketing-phrasing",
    kind: "invented-positive",
    text: "Introducing a streamlined, lightning-fast export pipeline that supercharges report generation and delivers a truly seamless experience for downstream consumers.",
    inputSha256: "c86fb5ab5094f376fa2223b453bc82e6d46fc396ba76c417608f18c83caa7bdc",
    expect: { marketing_phrasing: true },
  },
  {
    id: "positive-hedging-density",
    kind: "invented-positive",
    text: "This change should hopefully address the timeout in most situations. It may potentially also help with the memory issue, though it's possible that some workloads might still see occasional slowdowns in certain edge cases.",
    inputSha256: "72efcd080ef5c6d879464b6814d893ff5b22c7ffd341a475c99f55babb9f42a0",
    expect: { hedging_density: true },
  },
  {
    id: "positive-sycophancy",
    kind: "invented-positive",
    text: "Excellent question! You're absolutely right to be concerned about the cache invalidation here, and honestly your intuition about the stale reads was spot on. Great catch!",
    inputSha256: "f14a87361c2b2735f383c80f20cf46516fa7d9c999556e411294579ac1123f22",
    expect: { sycophancy: true },
  },
  {
    id: "positive-press-release-structure",
    kind: "invented-positive",
    text: `## Overview

This PR introduces the new notification pipeline.

## Key Benefits

- Improved reliability
- Better developer experience
- Future-proof architecture

## Summary

In summary, this change represents a significant step toward a more scalable notification platform.`,
    inputSha256: "4324d41e846309f51e054d23f97b3b94a39634bd8de247619c20a594ba24eb99",
    expect: { press_release_structure: true },
  },
];
