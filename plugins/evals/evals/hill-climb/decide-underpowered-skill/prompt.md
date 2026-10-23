/evals:hill-climb plugins/notes/skills/release-notes plugins/notes/evals/release-notes

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `release-notes` Climb

## Setup

- Target: `plugins/notes/skills/release-notes`
- Suite: `plugins/notes/evals/release-notes`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `76391e3`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1` | 2.1.230 | claude-sonnet-5-5 |

Each column is one results file from `--tag dev --runs 3`, so 3 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: `release-notes` never says where the version goes, so `names-version` fails when the diff is small. One rule to open the entry with the version number should lift it.

Target graders, registered before the run: `minor-bump/names-version`, with arm, up.

Guard graders, registered before the run: `patch-only/no-marketing`, `breaking-change/flags-breaking`.

Holdout: not run. The climb is still open and no change has been accepted yet.

Budget: one replicate per column, `--runs 3`.
````

## Dev comparison

```
Evaluation Diff: base → candidate
╔═══════════════════════════╤═══════════════════════════════════╤═══════════════╤═════════════════╤══════════════════════════════════════╗
║ Case ID                   │ Assertions                        │ Duration      │ Cost            │ Runs and permutation p-value         ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ minor-bump (with)         │ names-version: 0% → 100% (+100%)  │ 21.9s → 22.4s │ $0.089 → $0.092 │ names-version: 3 → 3 runs, p=0.101   ║
║                           │ lists-changes: 100% → 100% (+0%)  │               │                 │ lists-changes: 3 → 3 runs, p=1.000   ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ minor-bump (without)      │ names-version: 0% → 0% (+0%)      │ 16.4s → 16.8s │ $0.058 → $0.059 │ names-version: 3 → 3 runs, p=1.000   ║
║                           │ lists-changes: 100% → 100% (+0%)  │               │                 │ lists-changes: 3 → 3 runs, p=1.000   ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ patch-only (with)         │ no-marketing: 100% → 100% (+0%)   │ 17.9s → 18.3s │ $0.070 → $0.071 │ no-marketing: 3 → 3 runs, p=1.000    ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ patch-only (without)      │ no-marketing: 67% → 67% (+0%)     │ 13.4s → 13.7s │ $0.045 → $0.046 │ no-marketing: 3 → 3 runs, p=1.000    ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ breaking-change (with)    │ flags-breaking: 100% → 100% (+0%) │ 24.8s → 25.4s │ $0.109 → $0.112 │ flags-breaking: 3 → 3 runs, p=1.000  ║
║                           │ links-migration: 33% → 33% (+0%)  │               │                 │ links-migration: 3 → 3 runs, p=1.000 ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╟───────────────────────────┼───────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ breaking-change (without) │ flags-breaking: 100% → 100% (+0%) │ 18.6s → 19.1s │ $0.071 → $0.073 │ flags-breaking: 3 → 3 runs, p=1.000  ║
║                           │ links-migration: 67% → 67% (+0%)  │               │                 │ links-migration: 3 → 3 runs, p=1.000 ║
║                           │                                   │               │                 │ duration: p=0.699                    ║
║                           │                                   │               │                 │ cost: p=0.699                        ║
╚═══════════════════════════╧═══════════════════════════════════╧═══════════════╧═════════════════╧══════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
