/evals:hill-climb rules/log-fields.md evals/log-fields

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `log-fields` Climb

## Setup

- Target: `rules/log-fields.md`
- Suite: `evals/log-fields`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `06b88bd`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The rule says to log with fields but never names `request_id`, so `includes-request-id` fails on new handlers. Naming the field in the rule should lift it.

Target graders, registered before the run: `add-handler/includes-request-id`, with arm, up.

Guard graders, registered before the run: `cli-script/plain-print-ok`, `error-path/logs-once`.

Holdout: not run. The climb is still open and no change has been accepted yet.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite evals/log-fields --markdown --label base --label candidate results/base-1/aggregate-result.json,results/base-2/aggregate-result.json results/cand-1/aggregate-result.json,results/cand-2/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

| measure | row | base | candidate |
| --- | --- | --- | --- |
| Seconds per run | add-handler/with | 22.0 | 13.6 (p=0.001)* |
| Seconds per run | cli-script/with | 18.0 | 11.2 (p=0.001)* |
| Seconds per run | error-path/with | 25.0 | 15.5 (p=0.001)* |
| Cost per run (USD) | add-handler/with | 0.090 | 0.063 (p=0.001)* |
| Cost per run (USD) | cli-script/with | 0.070 | 0.049 (p=0.001)* |
| Cost per run (USD) | error-path/with | 0.110 | 0.077 (p=0.001)* |

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
| add-handler/with | 0.58 | 0.58 (p=1.000) |
| add-handler/without | 0.50 | 0.50 (p=1.000) |
| cli-script/with | 1.00 | 1.00 (p=1.000) |
| cli-script/without | 0.67 | 0.67 (p=1.000) |
| error-path/with | 0.58 | 0.58 (p=1.000) |
| error-path/without | 0.67 | 0.67 (p=1.000) |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 0.00 | 0.00 |
| add-handler/without | 0.00 | 0.00 |
| cli-script/with | 1.00 | 1.00 |
| cli-script/without | 0.00 | 0.00 |
| error-path/with | 0.00 | 0.00 |
| error-path/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 180 | 180 (p=1.000) |
| add-handler/without | 140 | 140 (p=1.000) |
| cli-script/with | 180 | 180 (p=1.000) |
| cli-script/without | 140 | 140 (p=1.000) |
| error-path/with | 180 | 180 (p=1.000) |
| error-path/without | 140 | 140 (p=1.000) |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 3.0 | 3.0 (p=1.000) |
| add-handler/without | 2.0 | 2.0 (p=1.000) |
| cli-script/with | 3.0 | 3.0 (p=1.000) |
| cli-script/without | 2.0 | 2.0 (p=1.000) |
| error-path/with | 3.0 | 3.0 (p=1.000) |
| error-path/without | 2.0 | 2.0 (p=1.000) |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 22.0 | 13.6 (p=0.001)* |
| add-handler/without | 16.5 | 16.5 (p=1.000) |
| cli-script/with | 18.0 | 11.2 (p=0.001)* |
| cli-script/without | 13.5 | 13.5 (p=1.000) |
| error-path/with | 25.0 | 15.5 (p=0.001)* |
| error-path/without | 18.8 | 18.8 (p=1.000) |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 900 | 900 (p=1.000) |
| add-handler/without | 700 | 700 (p=1.000) |
| cli-script/with | 900 | 900 (p=1.000) |
| cli-script/without | 700 | 700 (p=1.000) |
| error-path/with | 900 | 900 (p=1.000) |
| error-path/without | 700 | 700 (p=1.000) |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| add-handler/with | 0.090 | 0.063 (p=0.001)* |
| add-handler/without | 0.058 | 0.058 (p=1.000) |
| cli-script/with | 0.070 | 0.049 (p=0.001)* |
| cli-script/without | 0.046 | 0.046 (p=1.000) |
| error-path/with | 0.110 | 0.077 (p=0.001)* |
| error-path/without | 0.072 | 0.071 (p=0.983) |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | includes-request-id | 0.33 | 0.33 (p=1.000) |
| all/without | includes-request-id | 0.17 | 0.17 (p=1.000) |
| all/with | logs-once | 0.83 | 0.83 (p=1.000) |
| all/without | logs-once | 0.83 | 0.83 (p=1.000) |
| all/with | plain-print-ok | 1.00 | 1.00 (p=1.000) |
| all/without | plain-print-ok | 0.67 | 0.67 (p=1.000) |
| all/with | redacts-token | 0.33 | 0.33 (p=1.000) |
| all/without | redacts-token | 0.50 | 0.50 (p=1.000) |
| all/with | uses-logger | 0.83 | 0.83 (p=1.000) |
| all/without | uses-logger | 0.83 | 0.83 (p=1.000) |
| add-handler/with | includes-request-id | 0.33 | 0.33 (p=1.000) |
| add-handler/with | uses-logger | 0.83 | 0.83 (p=1.000) |
| add-handler/without | includes-request-id | 0.17 | 0.17 (p=1.000) |
| add-handler/without | uses-logger | 0.83 | 0.83 (p=1.000) |
| cli-script/with | plain-print-ok | 1.00 | 1.00 (p=1.000) |
| cli-script/without | plain-print-ok | 0.67 | 0.67 (p=1.000) |
| error-path/with | logs-once | 0.83 | 0.83 (p=1.000) |
| error-path/with | redacts-token | 0.33 | 0.33 (p=1.000) |
| error-path/without | logs-once | 0.83 | 0.83 (p=1.000) |
| error-path/without | redacts-token | 0.50 | 0.50 (p=1.000) |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
