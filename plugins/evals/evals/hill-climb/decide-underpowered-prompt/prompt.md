/evals:hill-climb prompts/support-bot.md evals/support-bot

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `support-bot` Climb

## Setup

- Target: `prompts/support-bot.md`
- Suite: `evals/support-bot`, 3 `dev` cases and 2 `holdout` cases, run on native `claude plugin eval`
- Base SHA: `9aa1cb1`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1` | 2.1.230 | claude-sonnet-5-5 |

Each column is one results file from `--tag dev --runs 3`, so 3 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The prompt never tells the bot to state the return window, so `states-window` fails on refund questions. One line giving the window rule should lift it.

Target graders, registered before the run: `refund-ask/states-window`, with arm, up.

Guard graders, registered before the run: `shipping-ask/no-invented-dates`, `angry-user/stays-polite`.

Holdout: not run. The climb is still open and no change has been accepted yet.

Budget: one replicate per column, `--runs 3`.
````

## Dev comparison

```
$ bun evals/native/compare.ts --suite evals/support-bot --markdown --label base --label candidate results/base-1/aggregate-result.json results/cand-1/aggregate-result.json
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
| all/with | 0.72 | 0.89 (p=0.331) |
| all/without | 0.67 | 0.67 (p=1.000) |
| angry-user/with | 0.67 | 0.67 (p=1.00)† |
| angry-user/without | 0.83 | 0.83 (p=1.00)† |
| refund-ask/with | 0.50 | 1.00 (p=0.10)† |
| refund-ask/without | 0.50 | 0.50 (p=1.00)† |
| shipping-ask/with | 1.00 | 1.00 (p=1.00)† |
| shipping-ask/without | 0.67 | 0.67 (p=1.00)† |

</details>

<details><summary>Case minimum</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 0.50 | 0.50 |
| angry-user/without | 0.50 | 0.50 |
| refund-ask/with | 0.50 | 1.00 |
| refund-ask/without | 0.50 | 0.50 |
| shipping-ask/with | 1.00 | 1.00 |
| shipping-ask/without | 0.00 | 0.00 |

</details>

<details><summary>Reply words</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 179 | 179 (p=1.00)† |
| angry-user/without | 139 | 139 (p=1.00)† |
| refund-ask/with | 179 | 179 (p=1.00)† |
| refund-ask/without | 139 | 139 (p=1.00)† |
| shipping-ask/with | 179 | 179 (p=1.00)† |
| shipping-ask/without | 139 | 139 (p=1.00)† |

</details>

<details><summary>Turns per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 3.0 | 3.0 (p=1.00)† |
| angry-user/without | 2.0 | 2.0 (p=1.00)† |
| refund-ask/with | 3.0 | 3.0 (p=1.00)† |
| refund-ask/without | 2.0 | 2.0 (p=1.00)† |
| shipping-ask/with | 3.0 | 3.0 (p=1.00)† |
| shipping-ask/without | 2.0 | 2.0 (p=1.00)† |

</details>

<details><summary>Seconds per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 24.8 | 25.4 (p=0.70)† |
| angry-user/without | 18.6 | 19.1 (p=0.70)† |
| refund-ask/with | 21.9 | 22.4 (p=0.70)† |
| refund-ask/without | 16.4 | 16.8 (p=0.70)† |
| shipping-ask/with | 17.9 | 18.3 (p=0.70)† |
| shipping-ask/without | 13.4 | 13.7 (p=0.70)† |

</details>

<details><summary>Output tokens per run</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 894 | 894 (p=1.00)† |
| angry-user/without | 695 | 695 (p=1.00)† |
| refund-ask/with | 894 | 894 (p=1.00)† |
| refund-ask/without | 695 | 695 (p=1.00)† |
| shipping-ask/with | 894 | 894 (p=1.00)† |
| shipping-ask/without | 695 | 695 (p=1.00)† |

</details>

<details><summary>Cost per run (USD)</summary>

| case/arm | base | candidate |
| --- | --- | --- |
| angry-user/with | 0.109 | 0.112 (p=0.70)† |
| angry-user/without | 0.071 | 0.073 (p=0.70)† |
| refund-ask/with | 0.089 | 0.092 (p=0.70)† |
| refund-ask/without | 0.058 | 0.059 (p=0.70)† |
| shipping-ask/with | 0.070 | 0.071 (p=0.70)† |
| shipping-ask/without | 0.045 | 0.046 (p=0.70)† |

</details>

<details><summary>Grader pass rate</summary>

| case/arm | grader | base | candidate |
| --- | --- | --- | --- |
| all/with | no-invented-dates | 1.00 | 1.00 (p=1.00)† |
| all/without | no-invented-dates | 0.67 | 0.67 (p=1.00)† |
| all/with | offers-human | 1.00 | 1.00 (p=1.00)† |
| all/without | offers-human | 1.00 | 1.00 (p=1.00)† |
| all/with | short-reply | 0.33 | 0.33 (p=1.00)† |
| all/without | short-reply | 0.67 | 0.67 (p=1.00)† |
| all/with | states-window | 0.00 | 1.00 (p=0.10)† |
| all/without | states-window | 0.00 | 0.00 (p=1.00)† |
| all/with | stays-polite | 1.00 | 1.00 (p=1.00)† |
| all/without | stays-polite | 1.00 | 1.00 (p=1.00)† |
| angry-user/with | short-reply | 0.33 | 0.33 (p=1.00)† |
| angry-user/with | stays-polite | 1.00 | 1.00 (p=1.00)† |
| angry-user/without | short-reply | 0.67 | 0.67 (p=1.00)† |
| angry-user/without | stays-polite | 1.00 | 1.00 (p=1.00)† |
| refund-ask/with | offers-human | 1.00 | 1.00 (p=1.00)† |
| refund-ask/with | states-window | 0.00 | 1.00 (p=0.10)† |
| refund-ask/without | offers-human | 1.00 | 1.00 (p=1.00)† |
| refund-ask/without | states-window | 0.00 | 0.00 (p=1.00)† |
| shipping-ask/with | no-invented-dates | 1.00 | 1.00 (p=1.00)† |
| shipping-ask/without | no-invented-dates | 0.67 | 0.67 (p=1.00)† |

</details>
`````

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
