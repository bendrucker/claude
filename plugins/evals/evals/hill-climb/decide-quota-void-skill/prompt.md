/evals:hill-climb plugins/notes/skills/release-notes plugins/notes/evals/release-notes

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `release-notes` Climb

## Setup

- Target: `plugins/notes/skills/release-notes`
- Suite: `plugins/notes/evals/release-notes`, 3 `dev` cases and 2 `holdout` cases, run on a custom runner that writes per-grader run and pass counts as CSV
- Base SHA: `50ad2b7`

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

Candidate results `cand-2` stopped at the session limit during `minor-bump` and `breaking-change`: 3 runs of each arm errored.
````

## Dev comparison

```
# base
case,arm,grader,runs,passes
minor-bump,with,names-version,6,1
minor-bump,with,lists-changes,6,5
minor-bump,without,names-version,6,1
minor-bump,without,lists-changes,6,5
patch-only,with,no-marketing,6,6
patch-only,without,no-marketing,6,4
breaking-change,with,flags-breaking,6,5
breaking-change,with,links-migration,6,2
breaking-change,without,flags-breaking,6,5
breaking-change,without,links-migration,6,3

case,arm,measure,runs,mean
minor-bump,with,seconds,6,22.0
minor-bump,with,cost,6,0.090
minor-bump,without,seconds,6,16.5
minor-bump,without,cost,6,0.058
patch-only,with,seconds,6,18.0
patch-only,with,cost,6,0.070
patch-only,without,seconds,6,13.5
patch-only,without,cost,6,0.046
breaking-change,with,seconds,6,25.0
breaking-change,with,cost,6,0.110
breaking-change,without,seconds,6,18.8
breaking-change,without,cost,6,0.072

# candidate
case,arm,grader,runs,passes
minor-bump,with,names-version,3,3
minor-bump,with,lists-changes,3,3
minor-bump,without,names-version,3,1
minor-bump,without,lists-changes,3,3
patch-only,with,no-marketing,6,6
patch-only,without,no-marketing,6,4
breaking-change,with,flags-breaking,3,3
breaking-change,with,links-migration,3,1
breaking-change,without,flags-breaking,3,3
breaking-change,without,links-migration,3,2

case,arm,measure,runs,mean
minor-bump,with,seconds,3,22.4
minor-bump,with,cost,3,0.092
minor-bump,without,seconds,3,16.8
minor-bump,without,cost,3,0.059
patch-only,with,seconds,6,18.0
patch-only,with,cost,6,0.070
patch-only,without,seconds,6,13.5
patch-only,without,cost,6,0.046
breaking-change,with,seconds,3,25.4
breaking-change,with,cost,3,0.112
breaking-change,without,seconds,3,19.1
breaking-change,without,cost,3,0.073

# permutation p-values, candidate against base, two-sided
case,arm,name,p
minor-bump,with,names-version,0.050
minor-bump,with,lists-changes,1.000
minor-bump,with,seconds,0.773
minor-bump,with,cost,0.773
minor-bump,without,names-version,1.000
minor-bump,without,lists-changes,1.000
minor-bump,without,seconds,0.773
minor-bump,without,cost,0.773
patch-only,with,no-marketing,1.000
patch-only,with,seconds,1.000
patch-only,with,cost,1.000
patch-only,without,no-marketing,1.000
patch-only,without,seconds,1.000
patch-only,without,cost,1.000
breaking-change,with,flags-breaking,1.000
breaking-change,with,links-migration,1.000
breaking-change,with,seconds,0.773
breaking-change,with,cost,0.773
breaking-change,without,flags-breaking,1.000
breaking-change,without,links-migration,1.000
breaking-change,without,seconds,0.773
breaking-change,without,cost,0.773
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
