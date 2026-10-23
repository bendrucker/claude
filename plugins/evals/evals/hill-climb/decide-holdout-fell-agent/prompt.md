/evals:hill-climb plugins/billing/agents/invoice-checker.md plugins/billing/evals/invoice-checker

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `invoice-checker` Climb

## Setup

- Target: `plugins/billing/agents/invoice-checker.md`
- Suite: `plugins/billing/evals/invoice-checker`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `1a10282`

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

Holdout: `--tag holdout`, run on the original base and on this candidate as the final commit, 2 replicates of 3 runs a side each.

Holdout: run once on the base and on this candidate as the final commit.
````

## Dev comparison

```
Evaluation Diff: base → candidate
╔══════════════════════════╤═══════════════════════════════════╤═══════════════╤═════════════════╤═══════════════════════════════════════╗
║ Case ID                  │ Assertions                        │ Duration      │ Cost            │ Runs and permutation p-value          ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ missing-total (with)     │ cites-line: 33% → 100% (+67%)     │ 22.0s → 22.0s │ $0.090 → $0.090 │ cites-line: 6 → 6 runs, p=0.060       ║
║                          │ names-vendor: 83% → 83% (+0%)     │               │                 │ names-vendor: 6 → 6 runs, p=1.000     ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=1.000                         ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ missing-total (without)  │ cites-line: 17% → 17% (+0%)       │ 16.5s → 16.5s │ $0.058 → $0.059 │ cites-line: 6 → 6 runs, p=1.000       ║
║                          │ names-vendor: 83% → 83% (+0%)     │               │                 │ names-vendor: 6 → 6 runs, p=1.000     ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=1.000                         ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ clean-invoice (with)     │ no-false-alarm: 100% → 100% (+0%) │ 18.0s → 18.0s │ $0.070 → $0.070 │ no-false-alarm: 6 → 6 runs, p=1.000   ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=1.000                         ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ clean-invoice (without)  │ no-false-alarm: 67% → 67% (+0%)   │ 13.5s → 13.5s │ $0.046 → $0.046 │ no-false-alarm: 6 → 6 runs, p=1.000   ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=1.000                         ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ duplicate-line (with)    │ asks-before-fix: 83% → 83% (+0%)  │ 25.0s → 25.0s │ $0.110 → $0.110 │ asks-before-fix: 6 → 6 runs, p=1.000  ║
║                          │ lists-both-lines: 33% → 33% (+0%) │               │                 │ lists-both-lines: 6 → 6 runs, p=1.000 ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=1.000                         ║
╟──────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼───────────────────────────────────────╢
║ duplicate-line (without) │ asks-before-fix: 83% → 83% (+0%)  │ 18.8s → 18.8s │ $0.072 → $0.071 │ asks-before-fix: 6 → 6 runs, p=1.000  ║
║                          │ lists-both-lines: 50% → 50% (+0%) │               │                 │ lists-both-lines: 6 → 6 runs, p=1.000 ║
║                          │                                   │               │                 │ duration: p=1.000                     ║
║                          │                                   │               │                 │ cost: p=0.983                         ║
╚══════════════════════════╧═══════════════════════════════════╧═══════════════╧═════════════════╧═══════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

## Holdout comparison

```
Evaluation Diff: base → final
╔═════════════════════════════╤═════════════════════════════════╤═══════════════╤═════════════════╤═════════════════════════════════════╗
║ Case ID                     │ Assertions                      │ Duration      │ Cost            │ Runs and permutation p-value        ║
╟─────────────────────────────┼─────────────────────────────────┼───────────────┼─────────────────┼─────────────────────────────────────╢
║ rounded-tax (with)          │ cites-line: 83% → 17% (-67%)    │ 20.0s → 20.0s │ $0.080 → $0.080 │ cites-line: 6 → 6 runs, p=0.085     ║
║                             │ no-false-alarm: 67% → 0% (-67%) │               │                 │ no-false-alarm: 6 → 6 runs, p=0.059 ║
║                             │                                 │               │                 │ duration: p=1.000                   ║
║                             │                                 │               │                 │ cost: p=1.000                       ║
╟─────────────────────────────┼─────────────────────────────────┼───────────────┼─────────────────┼─────────────────────────────────────╢
║ rounded-tax (without)       │ cites-line: 50% → 50% (+0%)     │ 15.0s → 15.0s │ $0.052 → $0.052 │ cites-line: 6 → 6 runs, p=1.000     ║
║                             │ no-false-alarm: 50% → 50% (+0%) │               │                 │ no-false-alarm: 6 → 6 runs, p=1.000 ║
║                             │                                 │               │                 │ duration: p=1.000                   ║
║                             │                                 │               │                 │ cost: p=0.972                       ║
╟─────────────────────────────┼─────────────────────────────────┼───────────────┼─────────────────┼─────────────────────────────────────╢
║ currency-mismatch (with)    │ names-currency: 67% → 0% (-67%) │ 19.0s → 19.0s │ $0.075 → $0.075 │ names-currency: 6 → 6 runs, p=0.059 ║
║                             │                                 │               │                 │ duration: p=1.000                   ║
║                             │                                 │               │                 │ cost: p=0.977                       ║
╟─────────────────────────────┼─────────────────────────────────┼───────────────┼─────────────────┼─────────────────────────────────────╢
║ currency-mismatch (without) │ names-currency: 33% → 33% (+0%) │ 14.3s → 14.2s │ $0.049 → $0.049 │ names-currency: 6 → 6 runs, p=1.000 ║
║                             │                                 │               │                 │ duration: p=1.000                   ║
║                             │                                 │               │                 │ cost: p=1.000                       ║
╚═════════════════════════════╧═════════════════════════════════╧═══════════════╧═════════════════╧═════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
