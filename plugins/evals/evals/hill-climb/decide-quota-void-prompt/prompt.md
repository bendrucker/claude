/evals:hill-climb prompts/support-bot.md evals/support-bot

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `support-bot` Climb

## Setup

- Target: `prompts/support-bot.md`
- Suite: `evals/support-bot`, 3 `dev` cases and 2 `holdout` cases, run on a custom runner that writes per-grader run and pass counts as CSV
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
# base
case,arm,grader,runs,passes
refund-ask,with,states-window,6,1
refund-ask,with,offers-human,6,5
refund-ask,without,states-window,6,1
refund-ask,without,offers-human,6,5
shipping-ask,with,no-invented-dates,6,6
shipping-ask,without,no-invented-dates,6,4
angry-user,with,stays-polite,6,5
angry-user,with,short-reply,6,2
angry-user,without,stays-polite,6,5
angry-user,without,short-reply,6,3

case,arm,measure,runs,mean
refund-ask,with,seconds,6,22.0
refund-ask,with,cost,6,0.090
refund-ask,without,seconds,6,16.5
refund-ask,without,cost,6,0.058
shipping-ask,with,seconds,6,18.0
shipping-ask,with,cost,6,0.070
shipping-ask,without,seconds,6,13.5
shipping-ask,without,cost,6,0.046
angry-user,with,seconds,6,25.0
angry-user,with,cost,6,0.110
angry-user,without,seconds,6,18.8
angry-user,without,cost,6,0.072

# candidate
case,arm,grader,runs,passes
refund-ask,with,states-window,3,3
refund-ask,with,offers-human,3,3
refund-ask,without,states-window,3,1
refund-ask,without,offers-human,3,3
shipping-ask,with,no-invented-dates,6,6
shipping-ask,without,no-invented-dates,6,4
angry-user,with,stays-polite,3,3
angry-user,with,short-reply,3,1
angry-user,without,stays-polite,3,3
angry-user,without,short-reply,3,2

case,arm,measure,runs,mean
refund-ask,with,seconds,3,22.4
refund-ask,with,cost,3,0.092
refund-ask,without,seconds,3,16.8
refund-ask,without,cost,3,0.059
shipping-ask,with,seconds,6,18.0
shipping-ask,with,cost,6,0.070
shipping-ask,without,seconds,6,13.5
shipping-ask,without,cost,6,0.046
angry-user,with,seconds,3,25.4
angry-user,with,cost,3,0.112
angry-user,without,seconds,3,19.1
angry-user,without,cost,3,0.073

# permutation p-values, candidate against base, two-sided
case,arm,name,p
refund-ask,with,states-window,0.050
refund-ask,with,offers-human,1.000
refund-ask,with,seconds,0.773
refund-ask,with,cost,0.773
refund-ask,without,states-window,1.000
refund-ask,without,offers-human,1.000
refund-ask,without,seconds,0.773
refund-ask,without,cost,0.773
shipping-ask,with,no-invented-dates,1.000
shipping-ask,with,seconds,1.000
shipping-ask,with,cost,1.000
shipping-ask,without,no-invented-dates,1.000
shipping-ask,without,seconds,1.000
shipping-ask,without,cost,1.000
angry-user,with,stays-polite,1.000
angry-user,with,short-reply,1.000
angry-user,with,seconds,0.773
angry-user,with,cost,0.773
angry-user,without,stays-polite,1.000
angry-user,without,short-reply,1.000
angry-user,without,seconds,0.773
angry-user,without,cost,0.773
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
