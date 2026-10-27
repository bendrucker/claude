/evals:hill-climb plugins/notes/skills/release-notes plugins/notes/evals/release-notes

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `release-notes` Climb

## Setup

- Target: `plugins/notes/skills/release-notes`
- Suite: `plugins/notes/evals/release-notes`, 3 `dev` cases and 2 `holdout` cases, run on pydantic-evals, diffed with `report.render(baseline=...)`
- Base SHA: `bde7321`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: `release-notes` never says where the version goes, so `names-version` fails when the diff is small. One rule to open the entry with the version number should lift it.

Target graders, registered before the run: `minor-bump/names-version`, with arm, up.

Guard graders, registered before the run: `patch-only/no-marketing`, `breaking-change/flags-breaking`.

Holdout: not run. The climb is still open and no change has been accepted yet.

Noise runs (two unchanged dev replicates of 3 runs a side): dev score 1.00 on the with arm and 1.00 on the without arm in both.
````

## Dev comparison

```
Evaluation Diff: base → candidate
╔═══════════════════════════╤════════════════════════════════════╤═══════════════╤═════════════════╤══════════════════════════════════════╗
║ Case ID                   │ Assertions                         │ Duration      │ Cost            │ Runs and permutation p-value         ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ minor-bump (with)         │ names-version: 100% → 100% (+0%)   │ 22.0s → 22.0s │ $0.090 → $0.090 │ names-version: 6 → 6 runs, p=1.000   ║
║                           │ lists-changes: 100% → 100% (+0%)   │               │                 │ lists-changes: 6 → 6 runs, p=1.000   ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=1.000                        ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ minor-bump (without)      │ names-version: 100% → 100% (+0%)   │ 16.5s → 16.5s │ $0.058 → $0.059 │ names-version: 6 → 6 runs, p=1.000   ║
║                           │ lists-changes: 100% → 100% (+0%)   │               │                 │ lists-changes: 6 → 6 runs, p=1.000   ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=1.000                        ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ patch-only (with)         │ no-marketing: 100% → 100% (+0%)    │ 18.0s → 18.0s │ $0.070 → $0.070 │ no-marketing: 6 → 6 runs, p=1.000    ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=1.000                        ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ patch-only (without)      │ no-marketing: 100% → 100% (+0%)    │ 13.5s → 13.5s │ $0.046 → $0.046 │ no-marketing: 6 → 6 runs, p=1.000    ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=1.000                        ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ breaking-change (with)    │ flags-breaking: 100% → 100% (+0%)  │ 25.0s → 25.0s │ $0.110 → $0.110 │ flags-breaking: 6 → 6 runs, p=1.000  ║
║                           │ links-migration: 100% → 100% (+0%) │               │                 │ links-migration: 6 → 6 runs, p=1.000 ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=1.000                        ║
╟───────────────────────────┼────────────────────────────────────┼───────────────┼─────────────────┼──────────────────────────────────────╢
║ breaking-change (without) │ flags-breaking: 100% → 100% (+0%)  │ 18.8s → 18.8s │ $0.072 → $0.071 │ flags-breaking: 6 → 6 runs, p=1.000  ║
║                           │ links-migration: 100% → 100% (+0%) │               │                 │ links-migration: 6 → 6 runs, p=1.000 ║
║                           │                                    │               │                 │ duration: p=1.000                    ║
║                           │                                    │               │                 │ cost: p=0.983                        ║
╚═══════════════════════════╧════════════════════════════════════╧═══════════════╧═════════════════╧══════════════════════════════════════╝

p-values are two-sided permutation tests of the candidate runs against the baseline runs.
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
