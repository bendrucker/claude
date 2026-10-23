/evals:hill-climb plugins/notes/skills/release-notes plugins/notes/evals/release-notes

Candidate 3 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `release-notes` Climb

## Setup

- Target: `plugins/notes/skills/release-notes`
- Suite: `plugins/notes/evals/release-notes`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `874a2ec`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1: accepted and merged. Candidate 2: null, target `minor-bump/names-version` 2/6 to 3/6 with no star, rejected and the PR closed. Candidate 3 is this one.

## Candidate 3

Hypothesis: `release-notes` never says where the version goes, so `names-version` fails when the diff is small. One rule to open the entry with the version number should lift it.

Target graders, registered before the run: `minor-bump/names-version`, with arm, up.

Guard graders, registered before the run: `patch-only/no-marketing`, `breaking-change/flags-breaking`.

Holdout: not run. The climb is still open and no change has been accepted yet.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite plugins/notes/evals/release-notes --markdown --label base --label candidate results/base-1/aggregate-result.json,results/base-2/aggregate-result.json results/cand-1/aggregate-result.json,results/cand-2/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

No row moved past the noise rule.

<details><summary>Tag score</summary>

| tag/arm | base | candidate |
| --- | --- | --- |
| dev/with | 0.72 | 0.72 (p=1.000) |
| dev/without | 0.61 | 0.61 (p=1.000) |

</details>

<details><summary>Case score</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| all/with | 0.72 | 0.72 (p=1.000) |
| all/without | 0.61 | 0.61 (p=1.000) |
| breaking-change/with | 0.58 | 0.58 (p=1.000) |
| breaking-change/without | 0.67 | 0.67 (p=1.000) |
| minor-bump/with | 0.58 | 0.58 (p=1.000) |
| minor-bump/without | 0.50 | 0.50 (p=1.000) |
| patch-only/with | 1.00 | 1.00 (p=1.000) |
| patch-only/without | 0.67 | 0.67 (p=1.000) |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 0.00 | 0.00 |
| breaking-change/without | 0.00 | 0.00 |
| minor-bump/with | 0.00 | 0.00 |
| minor-bump/without | 0.00 | 0.00 |
| patch-only/with | 1.00 | 1.00 |
| patch-only/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 180 | 180 (p=1.000) |
| breaking-change/without | 140 | 140 (p=1.000) |
| minor-bump/with | 180 | 180 (p=1.000) |
| minor-bump/without | 140 | 140 (p=1.000) |
| patch-only/with | 180 | 180 (p=1.000) |
| patch-only/without | 140 | 140 (p=1.000) |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 3.0 | 3.0 (p=1.000) |
| breaking-change/without | 2.0 | 2.0 (p=1.000) |
| minor-bump/with | 3.0 | 3.0 (p=1.000) |
| minor-bump/without | 2.0 | 2.0 (p=1.000) |
| patch-only/with | 3.0 | 3.0 (p=1.000) |
| patch-only/without | 2.0 | 2.0 (p=1.000) |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 25.0 | 25.0 (p=1.000) |
| breaking-change/without | 18.8 | 18.8 (p=1.000) |
| minor-bump/with | 22.0 | 22.0 (p=1.000) |
| minor-bump/without | 16.5 | 16.5 (p=1.000) |
| patch-only/with | 18.0 | 18.0 (p=1.000) |
| patch-only/without | 13.5 | 13.5 (p=1.000) |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 900 | 900 (p=1.000) |
| breaking-change/without | 700 | 700 (p=1.000) |
| minor-bump/with | 900 | 900 (p=1.000) |
| minor-bump/without | 700 | 700 (p=1.000) |
| patch-only/with | 900 | 900 (p=1.000) |
| patch-only/without | 700 | 700 (p=1.000) |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| breaking-change/with | 0.110 | 0.110 (p=1.000) |
| breaking-change/without | 0.072 | 0.071 (p=0.983) |
| minor-bump/with | 0.090 | 0.090 (p=1.000) |
| minor-bump/without | 0.058 | 0.058 (p=1.000) |
| patch-only/with | 0.070 | 0.070 (p=1.000) |
| patch-only/without | 0.046 | 0.046 (p=1.000) |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | flags-breaking | 0.83 | 0.83 (p=1.000) |
| all/without | flags-breaking | 0.83 | 0.83 (p=1.000) |
| all/with | links-migration | 0.33 | 0.33 (p=1.000) |
| all/without | links-migration | 0.50 | 0.50 (p=1.000) |
| all/with | lists-changes | 0.83 | 0.83 (p=1.000) |
| all/without | lists-changes | 0.83 | 0.83 (p=1.000) |
| all/with | names-version | 0.33 | 0.33 (p=1.000) |
| all/without | names-version | 0.17 | 0.17 (p=1.000) |
| all/with | no-marketing | 1.00 | 1.00 (p=1.000) |
| all/without | no-marketing | 0.67 | 0.67 (p=1.000) |
| breaking-change/with | flags-breaking | 0.83 | 0.83 (p=1.000) |
| breaking-change/with | links-migration | 0.33 | 0.33 (p=1.000) |
| breaking-change/without | flags-breaking | 0.83 | 0.83 (p=1.000) |
| breaking-change/without | links-migration | 0.50 | 0.50 (p=1.000) |
| minor-bump/with | lists-changes | 0.83 | 0.83 (p=1.000) |
| minor-bump/with | names-version | 0.33 | 0.33 (p=1.000) |
| minor-bump/without | lists-changes | 0.83 | 0.83 (p=1.000) |
| minor-bump/without | names-version | 0.17 | 0.17 (p=1.000) |
| patch-only/with | no-marketing | 1.00 | 1.00 (p=1.000) |
| patch-only/without | no-marketing | 0.67 | 0.67 (p=1.000) |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
