/evals:hill-climb rules/log-fields.md evals/log-fields

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `log-fields` Climb

## Setup

- Target: `rules/log-fields.md`
- Suite: `evals/log-fields`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `886d74a`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1` | 2.1.230 | claude-sonnet-5-5 |

Each column is one results file from `--tag dev --runs 3`, so 3 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The rule says to log with fields but never names `request_id`, so `includes-request-id` fails on new handlers. Naming the field in the rule should lift it.

Target graders, registered before the run: `add-handler/includes-request-id`, with arm, up.

Guard graders, registered before the run: `cli-script/plain-print-ok`, `error-path/logs-once`.

Holdout: not run. The climb is still open and no change has been accepted yet.

Budget: one replicate per column, `--runs 3`.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite evals/log-fields --markdown --label base --label candidate results/base-1/aggregate-result.json results/cand-1/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

No row moved past the noise rule.

<details><summary>Tag score</summary>

| tag/arm | base | candidate |
| --- | --- | --- |
| dev/with | 0.72 | 0.89 (p=0.348) |
| dev/without | 0.67 | 0.67 (p=1.000) |

</details>

<details><summary>Case score</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| all/with | 0.72 | 0.89 (p=0.348) |
| all/without | 0.67 | 0.67 (p=1.000) |
| add-handler/with | 0.50 | 1.00 (p=0.10)† |
| add-handler/without | 0.50 | 0.50 (p=1.00)† |
| cli-script/with | 1.00 | 1.00 (p=1.00)† |
| cli-script/without | 0.67 | 0.67 (p=1.00)† |
| error-path/with | 0.67 | 0.67 (p=1.00)† |
| error-path/without | 0.83 | 0.83 (p=1.00)† |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 0.50 | 1.00 |
| add-handler/without | 0.50 | 0.50 |
| cli-script/with | 1.00 | 1.00 |
| cli-script/without | 0.00 | 0.00 |
| error-path/with | 0.50 | 0.50 |
| error-path/without | 0.50 | 0.50 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 179 | 179 (p=1.00)† |
| add-handler/without | 139 | 139 (p=1.00)† |
| cli-script/with | 179 | 179 (p=1.00)† |
| cli-script/without | 139 | 139 (p=1.00)† |
| error-path/with | 179 | 179 (p=1.00)† |
| error-path/without | 139 | 139 (p=1.00)† |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 3.0 | 3.0 (p=1.00)† |
| add-handler/without | 2.0 | 2.0 (p=1.00)† |
| cli-script/with | 3.0 | 3.0 (p=1.00)† |
| cli-script/without | 2.0 | 2.0 (p=1.00)† |
| error-path/with | 3.0 | 3.0 (p=1.00)† |
| error-path/without | 2.0 | 2.0 (p=1.00)† |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 21.9 | 22.4 (p=0.70)† |
| add-handler/without | 16.4 | 16.8 (p=0.70)† |
| cli-script/with | 17.9 | 18.3 (p=0.70)† |
| cli-script/without | 13.4 | 13.7 (p=0.70)† |
| error-path/with | 24.8 | 25.4 (p=0.70)† |
| error-path/without | 18.6 | 19.1 (p=0.70)† |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 894 | 894 (p=1.00)† |
| add-handler/without | 695 | 695 (p=1.00)† |
| cli-script/with | 894 | 894 (p=1.00)† |
| cli-script/without | 695 | 695 (p=1.00)† |
| error-path/with | 894 | 894 (p=1.00)† |
| error-path/without | 695 | 695 (p=1.00)† |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 0.089 | 0.092 (p=0.70)† |
| add-handler/without | 0.058 | 0.059 (p=0.70)† |
| cli-script/with | 0.070 | 0.071 (p=0.70)† |
| cli-script/without | 0.045 | 0.046 (p=0.70)† |
| error-path/with | 0.109 | 0.112 (p=0.70)† |
| error-path/without | 0.071 | 0.073 (p=0.70)† |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | includes-request-id | 0.00 | 1.00 (p=0.10)† |
| all/without | includes-request-id | 0.00 | 0.00 (p=1.00)† |
| all/with | logs-once | 1.00 | 1.00 (p=1.00)† |
| all/without | logs-once | 1.00 | 1.00 (p=1.00)† |
| all/with | plain-print-ok | 1.00 | 1.00 (p=1.00)† |
| all/without | plain-print-ok | 0.67 | 0.67 (p=1.00)† |
| all/with | redacts-token | 0.33 | 0.33 (p=1.00)† |
| all/without | redacts-token | 0.67 | 0.67 (p=1.00)† |
| all/with | uses-logger | 1.00 | 1.00 (p=1.00)† |
| all/without | uses-logger | 1.00 | 1.00 (p=1.00)† |
| add-handler/with | includes-request-id | 0.00 | 1.00 (p=0.10)† |
| add-handler/with | uses-logger | 1.00 | 1.00 (p=1.00)† |
| add-handler/without | includes-request-id | 0.00 | 0.00 (p=1.00)† |
| add-handler/without | uses-logger | 1.00 | 1.00 (p=1.00)† |
| cli-script/with | plain-print-ok | 1.00 | 1.00 (p=1.00)† |
| cli-script/without | plain-print-ok | 0.67 | 0.67 (p=1.00)† |
| error-path/with | logs-once | 1.00 | 1.00 (p=1.00)† |
| error-path/with | redacts-token | 0.33 | 0.33 (p=1.00)† |
| error-path/without | logs-once | 1.00 | 1.00 (p=1.00)† |
| error-path/without | redacts-token | 0.67 | 0.67 (p=1.00)† |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
