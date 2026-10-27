/evals:hill-climb prompts/support-bot.md evals/support-bot

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `support-bot` Climb

## Setup

- Target: `prompts/support-bot.md`
- Suite: `evals/support-bot`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `7515d85`

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

Holdout: not run. The climb is still open and no change has been accepted yet.

Candidate results `cand-2` stopped at the session limit during `refund-ask` and `angry-user`: 3 runs of each arm errored.
````

## Dev comparison

```
Evaluation Diff: base → candidate
╔════════════════════════╤══════════════════════════════════════╤═══════════════╤═════════════════╤════════════════════════════════════════╗
║ Case ID                │ Assertions                           │ Duration      │ Cost            │ Runs and permutation p-value           ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ refund-ask (with)      │ states-window: 17% → 100% (+83%)     │ 22.0s → 22.4s │ $0.090 → $0.092 │ states-window: 6 → 3 runs, p=0.050     ║
║                        │ offers-human: 83% → 100% (+17%)      │               │                 │ offers-human: 6 → 3 runs, p=1.000      ║
║                        │                                      │               │                 │ duration: p=0.773                      ║
║                        │                                      │               │                 │ cost: p=0.773                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ refund-ask (without)   │ states-window: 17% → 33% (+17%)      │ 16.5s → 16.8s │ $0.058 → $0.059 │ states-window: 6 → 3 runs, p=1.000     ║
║                        │ offers-human: 83% → 100% (+17%)      │               │                 │ offers-human: 6 → 3 runs, p=1.000      ║
║                        │                                      │               │                 │ duration: p=0.773                      ║
║                        │                                      │               │                 │ cost: p=0.773                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ shipping-ask (with)    │ no-invented-dates: 100% → 100% (+0%) │ 18.0s → 18.0s │ $0.070 → $0.070 │ no-invented-dates: 6 → 6 runs, p=1.000 ║
║                        │                                      │               │                 │ duration: p=1.000                      ║
║                        │                                      │               │                 │ cost: p=1.000                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ shipping-ask (without) │ no-invented-dates: 67% → 67% (+0%)   │ 13.5s → 13.5s │ $0.046 → $0.046 │ no-invented-dates: 6 → 6 runs, p=1.000 ║
║                        │                                      │               │                 │ duration: p=1.000                      ║
║                        │                                      │               │                 │ cost: p=1.000                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ angry-user (with)      │ stays-polite: 83% → 100% (+17%)      │ 25.0s → 25.4s │ $0.110 → $0.112 │ stays-polite: 6 → 3 runs, p=1.000      ║
║                        │ short-reply: 33% → 33% (+0%)         │               │                 │ short-reply: 6 → 3 runs, p=1.000       ║
║                        │                                      │               │                 │ duration: p=0.773                      ║
║                        │                                      │               │                 │ cost: p=0.773                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ angry-user (without)   │ stays-polite: 83% → 100% (+17%)      │ 18.8s → 19.1s │ $0.072 → $0.073 │ stays-polite: 6 → 3 runs, p=1.000      ║
║                        │ short-reply: 50% → 67% (+17%)        │               │                 │ short-reply: 6 → 3 runs, p=1.000       ║
║                        │                                      │               │                 │ duration: p=0.773                      ║
║                        │                                      │               │                 │ cost: p=0.773                          ║
╚════════════════════════╧══════════════════════════════════════╧═══════════════╧═════════════════╧════════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.

Case Failures
- refund-ask (with): 3 runs errored, session limit
- refund-ask (without): 3 runs errored, session limit
- angry-user (with): 3 runs errored, session limit
- angry-user (without): 3 runs errored, session limit
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
