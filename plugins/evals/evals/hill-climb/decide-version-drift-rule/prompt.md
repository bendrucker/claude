/evals:hill-climb rules/log-fields.md evals/log-fields

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `log-fields` Climb

## Setup

- Target: `rules/log-fields.md`
- Suite: `evals/log-fields`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `3d558f2`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.236 | claude-sonnet-5-5 |

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
Evaluation Diff: base → candidate
╔═══════════════════════╤════════════════════════════════════════╤═══════════════╤═════════════════╤══════════════════════════════════════════╗
║ Case ID               │ Assertions                             │ Duration      │ Cost            │ Runs and permutation p-value             ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ add-handler (with)    │ includes-request-id: 33% → 100% (+67%) │ 22.0s → 22.0s │ $0.090 → $0.090 │ includes-request-id: 6 → 6 runs, p=0.060 ║
║                       │ uses-logger: 83% → 83% (+0%)           │               │                 │ uses-logger: 6 → 6 runs, p=1.000         ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=1.000                            ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ add-handler (without) │ includes-request-id: 17% → 17% (+0%)   │ 16.5s → 16.5s │ $0.058 → $0.059 │ includes-request-id: 6 → 6 runs, p=1.000 ║
║                       │ uses-logger: 83% → 83% (+0%)           │               │                 │ uses-logger: 6 → 6 runs, p=1.000         ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=1.000                            ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ cli-script (with)     │ plain-print-ok: 100% → 100% (+0%)      │ 18.0s → 18.0s │ $0.070 → $0.070 │ plain-print-ok: 6 → 6 runs, p=1.000      ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=1.000                            ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ cli-script (without)  │ plain-print-ok: 67% → 67% (+0%)        │ 13.5s → 13.5s │ $0.046 → $0.046 │ plain-print-ok: 6 → 6 runs, p=1.000      ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=1.000                            ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ error-path (with)     │ logs-once: 83% → 83% (+0%)             │ 25.0s → 25.0s │ $0.110 → $0.110 │ logs-once: 6 → 6 runs, p=1.000           ║
║                       │ redacts-token: 33% → 33% (+0%)         │               │                 │ redacts-token: 6 → 6 runs, p=1.000       ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=1.000                            ║
╟───────────────────────┼────────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────────╢
║ error-path (without)  │ logs-once: 83% → 83% (+0%)             │ 18.8s → 18.8s │ $0.072 → $0.071 │ logs-once: 6 → 6 runs, p=1.000           ║
║                       │ redacts-token: 50% → 50% (+0%)         │               │                 │ redacts-token: 6 → 6 runs, p=1.000       ║
║                       │                                        │               │                 │ duration: p=1.000                        ║
║                       │                                        │               │                 │ cost: p=0.983                            ║
╚═══════════════════════╧════════════════════════════════════════╧═══════════════╧═════════════════╧══════════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
