/evals:hill-climb prompts/support-bot.md evals/support-bot

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `support-bot` Climb

## Setup

- Target: `prompts/support-bot.md`
- Suite: `evals/support-bot`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `3e78d50`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The prompt never tells the bot to state the return window, so `states-window` fails on refund questions. One line giving the window rule should lift it.

Target graders, registered before the run: `refund-ask/states-window`, with arm, up.

Guard graders, registered before the run: `shipping-ask/no-invented-dates`, `angry-user/stays-polite`.

Holdout: `--tag holdout`, run on the original base and on this candidate as the final commit, 2 replicates of 3 runs a side each.

Holdout: run once on the base and on this candidate as the final commit.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite evals/support-bot --markdown --label base --label candidate results/base-1/aggregate-result.json,results/base-2/aggregate-result.json results/cand-1/aggregate-result.json,results/cand-2/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

| measure | row | base | candidate |
| --- | --- | --- | --- |
| Grader pass rate | all/with · states-window | 0.33 | 1.00 (p=0.060)* |
| Grader pass rate | refund-ask/with · states-window | 0.33 | 1.00 (p=0.060)* |

<details><summary>Tag score</summary>

| tag/arm | base | candidate |
| --- | --- | --- |
| dev/with | 0.72 | 0.83 (p=0.443) |
| dev/without | 0.61 | 0.61 (p=1.000) |

</details>

<details><summary>Case score</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| all/with | 0.72 | 0.83 (p=0.443) |
| all/without | 0.61 | 0.61 (p=1.000) |
| angry-user/with | 0.58 | 0.58 (p=1.000) |
| angry-user/without | 0.67 | 0.67 (p=1.000) |
| refund-ask/with | 0.58 | 0.92 (p=0.191) |
| refund-ask/without | 0.50 | 0.50 (p=1.000) |
| shipping-ask/with | 1.00 | 1.00 (p=1.000) |
| shipping-ask/without | 0.67 | 0.67 (p=1.000) |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 0.00 | 0.00 |
| angry-user/without | 0.00 | 0.00 |
| refund-ask/with | 0.00 | 0.50 |
| refund-ask/without | 0.00 | 0.00 |
| shipping-ask/with | 1.00 | 1.00 |
| shipping-ask/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 180 | 180 (p=1.000) |
| angry-user/without | 140 | 140 (p=1.000) |
| refund-ask/with | 180 | 180 (p=1.000) |
| refund-ask/without | 140 | 140 (p=1.000) |
| shipping-ask/with | 180 | 180 (p=1.000) |
| shipping-ask/without | 140 | 140 (p=1.000) |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 3.0 | 3.0 (p=1.000) |
| angry-user/without | 2.0 | 2.0 (p=1.000) |
| refund-ask/with | 3.0 | 3.0 (p=1.000) |
| refund-ask/without | 2.0 | 2.0 (p=1.000) |
| shipping-ask/with | 3.0 | 3.0 (p=1.000) |
| shipping-ask/without | 2.0 | 2.0 (p=1.000) |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 25.0 | 25.0 (p=1.000) |
| angry-user/without | 18.8 | 18.8 (p=1.000) |
| refund-ask/with | 22.0 | 22.0 (p=1.000) |
| refund-ask/without | 16.5 | 16.5 (p=1.000) |
| shipping-ask/with | 18.0 | 18.0 (p=1.000) |
| shipping-ask/without | 13.5 | 13.5 (p=1.000) |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 900 | 900 (p=1.000) |
| angry-user/without | 700 | 700 (p=1.000) |
| refund-ask/with | 900 | 900 (p=1.000) |
| refund-ask/without | 700 | 700 (p=1.000) |
| shipping-ask/with | 900 | 900 (p=1.000) |
| shipping-ask/without | 700 | 700 (p=1.000) |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 0.110 | 0.110 (p=1.000) |
| angry-user/without | 0.072 | 0.071 (p=0.983) |
| refund-ask/with | 0.090 | 0.090 (p=1.000) |
| refund-ask/without | 0.058 | 0.058 (p=1.000) |
| shipping-ask/with | 0.070 | 0.070 (p=1.000) |
| shipping-ask/without | 0.046 | 0.046 (p=1.000) |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | no-invented-dates | 1.00 | 1.00 (p=1.000) |
| all/without | no-invented-dates | 0.67 | 0.67 (p=1.000) |
| all/with | offers-human | 0.83 | 0.83 (p=1.000) |
| all/without | offers-human | 0.83 | 0.83 (p=1.000) |
| all/with | short-reply | 0.33 | 0.33 (p=1.000) |
| all/without | short-reply | 0.50 | 0.50 (p=1.000) |
| all/with | states-window | 0.33 | 1.00 (p=0.060)* |
| all/without | states-window | 0.17 | 0.17 (p=1.000) |
| all/with | stays-polite | 0.83 | 0.83 (p=1.000) |
| all/without | stays-polite | 0.83 | 0.83 (p=1.000) |
| angry-user/with | short-reply | 0.33 | 0.33 (p=1.000) |
| angry-user/with | stays-polite | 0.83 | 0.83 (p=1.000) |
| angry-user/without | short-reply | 0.50 | 0.50 (p=1.000) |
| angry-user/without | stays-polite | 0.83 | 0.83 (p=1.000) |
| refund-ask/with | offers-human | 0.83 | 0.83 (p=1.000) |
| refund-ask/with | states-window | 0.33 | 1.00 (p=0.060)* |
| refund-ask/without | offers-human | 0.83 | 0.83 (p=1.000) |
| refund-ask/without | states-window | 0.17 | 0.17 (p=1.000) |
| shipping-ask/with | no-invented-dates | 1.00 | 1.00 (p=1.000) |
| shipping-ask/without | no-invented-dates | 0.67 | 0.67 (p=1.000) |

</details>
`````

## Holdout comparison

```
$ bun evals/native/compare.ts --suite evals/support-bot --markdown --label base --label final results/holdout-base-1/aggregate-result.json,results/holdout-base-2/aggregate-result.json results/holdout-final-1/aggregate-result.json,results/holdout-final-2/aggregate-result.json
```

`````markdown
Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. all/<arm> pools every case's runs. † marks a cell with too few runs on one side for any star, which takes at least 4 against 4 at 0.1. ! marks a case whose errored runs, such as a session limit, were left out of the pool.

| measure | row | base | final |
| --- | --- | --- | --- |
| Tag score | holdout/with | 0.71 | 0.04 (p=0.000)* |
| Case score | all/with | 0.71 | 0.04 (p=0.000)* |
| Case score | exchange-ask/with | 0.75 | 0.08 (p=0.029)* |
| Case score | out-of-scope/with | 0.67 | 0.00 (p=0.059)* |
| Grader pass rate | all/with · declines-politely | 0.67 | 0.00 (p=0.059)* |
| Grader pass rate | all/with · no-invented-dates | 0.67 | 0.00 (p=0.059)* |
| Grader pass rate | all/with · states-window | 0.83 | 0.17 (p=0.085)* |
| Grader pass rate | exchange-ask/with · no-invented-dates | 0.67 | 0.00 (p=0.059)* |
| Grader pass rate | exchange-ask/with · states-window | 0.83 | 0.17 (p=0.085)* |
| Grader pass rate | out-of-scope/with · declines-politely | 0.67 | 0.00 (p=0.059)* |

<details><summary>Tag score</summary>

| tag/arm | base | final |
| --- | --- | --- |
| holdout/with | 0.71 | 0.04 (p=0.000)* |
| holdout/without | 0.42 | 0.42 (p=1.000) |

</details>

<details><summary>Case score</summary>

| case/arm | base | final |
| --- | --- | --- |
| all/with | 0.71 | 0.04 (p=0.000)* |
| all/without | 0.42 | 0.42 (p=1.000) |
| exchange-ask/with | 0.75 | 0.08 (p=0.029)* |
| exchange-ask/without | 0.50 | 0.50 (p=1.000) |
| out-of-scope/with | 0.67 | 0.00 (p=0.059)* |
| out-of-scope/without | 0.33 | 0.33 (p=1.000) |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 0.00 | 0.00 |
| exchange-ask/without | 0.00 | 0.00 |
| out-of-scope/with | 0.00 | 0.00 |
| out-of-scope/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 180 | 180 (p=1.000) |
| exchange-ask/without | 140 | 140 (p=1.000) |
| out-of-scope/with | 180 | 180 (p=1.000) |
| out-of-scope/without | 140 | 140 (p=1.000) |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 3.0 | 3.0 (p=1.000) |
| exchange-ask/without | 2.0 | 2.0 (p=1.000) |
| out-of-scope/with | 3.0 | 3.0 (p=1.000) |
| out-of-scope/without | 2.0 | 2.0 (p=1.000) |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 20.0 | 20.0 (p=1.000) |
| exchange-ask/without | 15.0 | 15.0 (p=1.000) |
| out-of-scope/with | 19.0 | 19.0 (p=1.000) |
| out-of-scope/without | 14.3 | 14.3 (p=1.000) |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 900 | 900 (p=1.000) |
| exchange-ask/without | 700 | 700 (p=1.000) |
| out-of-scope/with | 900 | 900 (p=1.000) |
| out-of-scope/without | 700 | 700 (p=1.000) |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | final |
| --- | --- | --- |
| exchange-ask/with | 0.080 | 0.080 (p=1.000) |
| exchange-ask/without | 0.052 | 0.052 (p=0.972) |
| out-of-scope/with | 0.075 | 0.075 (p=0.977) |
| out-of-scope/without | 0.049 | 0.049 (p=1.000) |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | final |
| --- | --- | --- | --- |
| all/with | declines-politely | 0.67 | 0.00 (p=0.059)* |
| all/without | declines-politely | 0.33 | 0.33 (p=1.000) |
| all/with | no-invented-dates | 0.67 | 0.00 (p=0.059)* |
| all/without | no-invented-dates | 0.50 | 0.50 (p=1.000) |
| all/with | states-window | 0.83 | 0.17 (p=0.085)* |
| all/without | states-window | 0.50 | 0.50 (p=1.000) |
| exchange-ask/with | no-invented-dates | 0.67 | 0.00 (p=0.059)* |
| exchange-ask/with | states-window | 0.83 | 0.17 (p=0.085)* |
| exchange-ask/without | no-invented-dates | 0.50 | 0.50 (p=1.000) |
| exchange-ask/without | states-window | 0.50 | 0.50 (p=1.000) |
| out-of-scope/with | declines-politely | 0.67 | 0.00 (p=0.059)* |
| out-of-scope/without | declines-politely | 0.33 | 0.33 (p=1.000) |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
