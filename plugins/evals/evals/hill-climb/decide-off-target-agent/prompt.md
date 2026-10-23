/evals:hill-climb plugins/billing/agents/invoice-checker.md plugins/billing/evals/invoice-checker

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `invoice-checker` Climb

## Setup

- Target: `plugins/billing/agents/invoice-checker.md`
- Suite: `plugins/billing/evals/invoice-checker`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `bf0a77f`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: `invoice-checker` reports a missing total without saying which line it checked, so `cites-line` fails. One rule to quote the line it checked should lift it.

Target graders, registered before the run: `missing-total/cites-line`, with arm, up.

Guard graders, registered before the run: `clean-invoice/no-false-alarm`, `duplicate-line/asks-before-fix`.

Holdout: not run. The climb is still open and no change has been accepted yet.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite plugins/billing/evals/invoice-checker --markdown --label base --label candidate results/base-1/aggregate-result.json,results/base-2/aggregate-result.json results/cand-1/aggregate-result.json,results/cand-2/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

| measure | row | base | candidate |
| --- | --- | --- | --- |
| Grader pass rate | all/with · lists-both-lines | 0.33 | 1.00 (p=0.060)* |
| Grader pass rate | duplicate-line/with · lists-both-lines | 0.33 | 1.00 (p=0.060)* |

<details><summary>Tag score</summary>

| tag/arm | base | candidate |
| --- | --- | --- |
| dev/with | 0.72 | 0.83 (p=0.449) |
| dev/without | 0.61 | 0.61 (p=1.000) |

</details>

<details><summary>Case score</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| all/with | 0.72 | 0.83 (p=0.441) |
| all/without | 0.61 | 0.61 (p=1.000) |
| clean-invoice/with | 1.00 | 1.00 (p=1.000) |
| clean-invoice/without | 0.67 | 0.67 (p=1.000) |
| duplicate-line/with | 0.58 | 0.92 (p=0.191) |
| duplicate-line/without | 0.67 | 0.67 (p=1.000) |
| missing-total/with | 0.58 | 0.58 (p=1.000) |
| missing-total/without | 0.50 | 0.50 (p=1.000) |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 1.00 | 1.00 |
| clean-invoice/without | 0.00 | 0.00 |
| duplicate-line/with | 0.00 | 0.50 |
| duplicate-line/without | 0.00 | 0.00 |
| missing-total/with | 0.00 | 0.00 |
| missing-total/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 180 | 180 (p=1.000) |
| clean-invoice/without | 140 | 140 (p=1.000) |
| duplicate-line/with | 180 | 180 (p=1.000) |
| duplicate-line/without | 140 | 140 (p=1.000) |
| missing-total/with | 180 | 180 (p=1.000) |
| missing-total/without | 140 | 140 (p=1.000) |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 3.0 | 3.0 (p=1.000) |
| clean-invoice/without | 2.0 | 2.0 (p=1.000) |
| duplicate-line/with | 3.0 | 3.0 (p=1.000) |
| duplicate-line/without | 2.0 | 2.0 (p=1.000) |
| missing-total/with | 3.0 | 3.0 (p=1.000) |
| missing-total/without | 2.0 | 2.0 (p=1.000) |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 18.0 | 18.0 (p=1.000) |
| clean-invoice/without | 13.5 | 13.5 (p=1.000) |
| duplicate-line/with | 25.0 | 25.0 (p=1.000) |
| duplicate-line/without | 18.8 | 18.8 (p=1.000) |
| missing-total/with | 22.0 | 22.0 (p=1.000) |
| missing-total/without | 16.5 | 16.5 (p=1.000) |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 900 | 900 (p=1.000) |
| clean-invoice/without | 700 | 700 (p=1.000) |
| duplicate-line/with | 900 | 900 (p=1.000) |
| duplicate-line/without | 700 | 700 (p=1.000) |
| missing-total/with | 900 | 900 (p=1.000) |
| missing-total/without | 700 | 700 (p=1.000) |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| clean-invoice/with | 0.070 | 0.070 (p=1.000) |
| clean-invoice/without | 0.046 | 0.046 (p=1.000) |
| duplicate-line/with | 0.110 | 0.110 (p=1.000) |
| duplicate-line/without | 0.072 | 0.071 (p=0.983) |
| missing-total/with | 0.090 | 0.090 (p=1.000) |
| missing-total/without | 0.058 | 0.058 (p=1.000) |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | asks-before-fix | 0.83 | 0.83 (p=1.000) |
| all/without | asks-before-fix | 0.83 | 0.83 (p=1.000) |
| all/with | cites-line | 0.33 | 0.33 (p=1.000) |
| all/without | cites-line | 0.17 | 0.17 (p=1.000) |
| all/with | lists-both-lines | 0.33 | 1.00 (p=0.060)* |
| all/without | lists-both-lines | 0.50 | 0.50 (p=1.000) |
| all/with | names-vendor | 0.83 | 0.83 (p=1.000) |
| all/without | names-vendor | 0.83 | 0.83 (p=1.000) |
| all/with | no-false-alarm | 1.00 | 1.00 (p=1.000) |
| all/without | no-false-alarm | 0.67 | 0.67 (p=1.000) |
| clean-invoice/with | no-false-alarm | 1.00 | 1.00 (p=1.000) |
| clean-invoice/without | no-false-alarm | 0.67 | 0.67 (p=1.000) |
| duplicate-line/with | asks-before-fix | 0.83 | 0.83 (p=1.000) |
| duplicate-line/with | lists-both-lines | 0.33 | 1.00 (p=0.060)* |
| duplicate-line/without | asks-before-fix | 0.83 | 0.83 (p=1.000) |
| duplicate-line/without | lists-both-lines | 0.50 | 0.50 (p=1.000) |
| missing-total/with | cites-line | 0.33 | 0.33 (p=1.000) |
| missing-total/with | names-vendor | 0.83 | 0.83 (p=1.000) |
| missing-total/without | cites-line | 0.17 | 0.17 (p=1.000) |
| missing-total/without | names-vendor | 0.83 | 0.83 (p=1.000) |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
