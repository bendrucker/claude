/evals:hill-climb prompts/support-bot.md evals/support-bot

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `support-bot` Climb

## Setup

- Target: `prompts/support-bot.md`
- Suite: `evals/support-bot`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `18ece24`

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
````

## Dev comparison

```
Evaluation Diff: base → candidate
╔════════════════════════╤══════════════════════════════════════╤═══════════════╤═════════════════╤════════════════════════════════════════╗
║ Case ID                │ Assertions                           │ Duration      │ Cost            │ Runs and permutation p-value           ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ refund-ask (with)      │ states-window: 33% → 33% (+0%)       │ 22.0s → 13.6s │ $0.090 → $0.063 │ states-window: 6 → 6 runs, p=1.000     ║
║                        │ offers-human: 83% → 83% (+0%)        │               │                 │ offers-human: 6 → 6 runs, p=1.000      ║
║                        │                                      │               │                 │ duration: p=0.001                      ║
║                        │                                      │               │                 │ cost: p=0.001                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ refund-ask (without)   │ states-window: 17% → 17% (+0%)       │ 16.5s → 16.5s │ $0.058 → $0.059 │ states-window: 6 → 6 runs, p=1.000     ║
║                        │ offers-human: 83% → 83% (+0%)        │               │                 │ offers-human: 6 → 6 runs, p=1.000      ║
║                        │                                      │               │                 │ duration: p=1.000                      ║
║                        │                                      │               │                 │ cost: p=1.000                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ shipping-ask (with)    │ no-invented-dates: 100% → 100% (+0%) │ 18.0s → 11.2s │ $0.070 → $0.049 │ no-invented-dates: 6 → 6 runs, p=1.000 ║
║                        │                                      │               │                 │ duration: p=0.001                      ║
║                        │                                      │               │                 │ cost: p=0.001                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ shipping-ask (without) │ no-invented-dates: 67% → 67% (+0%)   │ 13.5s → 13.5s │ $0.046 → $0.046 │ no-invented-dates: 6 → 6 runs, p=1.000 ║
║                        │                                      │               │                 │ duration: p=1.000                      ║
║                        │                                      │               │                 │ cost: p=1.000                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ angry-user (with)      │ stays-polite: 83% → 83% (+0%)        │ 25.0s → 15.5s │ $0.110 → $0.077 │ stays-polite: 6 → 6 runs, p=1.000      ║
║                        │ short-reply: 33% → 33% (+0%)         │               │                 │ short-reply: 6 → 6 runs, p=1.000       ║
║                        │                                      │               │                 │ duration: p=0.001                      ║
║                        │                                      │               │                 │ cost: p=0.001                          ║
╟────────────────────────┼──────────────────────────────────────┼───────────────┼─────────────────┼────────────────────────────────────────╢
║ angry-user (without)   │ stays-polite: 83% → 83% (+0%)        │ 18.8s → 18.8s │ $0.072 → $0.071 │ stays-polite: 6 → 6 runs, p=1.000      ║
║                        │ short-reply: 50% → 50% (+0%)         │               │                 │ short-reply: 6 → 6 runs, p=1.000       ║
║                        │                                      │               │                 │ duration: p=1.000                      ║
║                        │                                      │               │                 │ cost: p=0.983                          ║
╚════════════════════════╧══════════════════════════════════════╧═══════════════╧═════════════════╧════════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
