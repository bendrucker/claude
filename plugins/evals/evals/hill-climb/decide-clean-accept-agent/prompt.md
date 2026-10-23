/evals:hill-climb plugins/billing/agents/invoice-checker.md plugins/billing/evals/invoice-checker

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `invoice-checker` Climb

## Setup

- Target: `plugins/billing/agents/invoice-checker.md`
- Suite: `plugins/billing/evals/invoice-checker`, 3 `dev` cases and 2 `holdout` cases, run on a custom runner that writes per-grader run and pass counts as CSV
- Base SHA: `73f2927`

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
# base
case,arm,grader,runs,passes
missing-total,with,cites-line,6,2
missing-total,with,names-vendor,6,5
missing-total,without,cites-line,6,1
missing-total,without,names-vendor,6,5
clean-invoice,with,no-false-alarm,6,6
clean-invoice,without,no-false-alarm,6,4
duplicate-line,with,asks-before-fix,6,5
duplicate-line,with,lists-both-lines,6,2
duplicate-line,without,asks-before-fix,6,5
duplicate-line,without,lists-both-lines,6,3

case,arm,measure,runs,mean
missing-total,with,seconds,6,22.0
missing-total,with,cost,6,0.090
missing-total,without,seconds,6,16.5
missing-total,without,cost,6,0.058
clean-invoice,with,seconds,6,18.0
clean-invoice,with,cost,6,0.070
clean-invoice,without,seconds,6,13.5
clean-invoice,without,cost,6,0.046
duplicate-line,with,seconds,6,25.0
duplicate-line,with,cost,6,0.110
duplicate-line,without,seconds,6,18.8
duplicate-line,without,cost,6,0.072

# candidate
case,arm,grader,runs,passes
missing-total,with,cites-line,6,6
missing-total,with,names-vendor,6,5
missing-total,without,cites-line,6,1
missing-total,without,names-vendor,6,5
clean-invoice,with,no-false-alarm,6,6
clean-invoice,without,no-false-alarm,6,4
duplicate-line,with,asks-before-fix,6,5
duplicate-line,with,lists-both-lines,6,2
duplicate-line,without,asks-before-fix,6,5
duplicate-line,without,lists-both-lines,6,3

case,arm,measure,runs,mean
missing-total,with,seconds,6,22.0
missing-total,with,cost,6,0.090
missing-total,without,seconds,6,16.5
missing-total,without,cost,6,0.059
clean-invoice,with,seconds,6,18.0
clean-invoice,with,cost,6,0.070
clean-invoice,without,seconds,6,13.5
clean-invoice,without,cost,6,0.046
duplicate-line,with,seconds,6,25.0
duplicate-line,with,cost,6,0.110
duplicate-line,without,seconds,6,18.8
duplicate-line,without,cost,6,0.071

# permutation p-values, candidate against base, two-sided
case,arm,name,p
missing-total,with,cites-line,0.060
missing-total,with,names-vendor,1.000
missing-total,with,seconds,1.000
missing-total,with,cost,1.000
missing-total,without,cites-line,1.000
missing-total,without,names-vendor,1.000
missing-total,without,seconds,1.000
missing-total,without,cost,1.000
clean-invoice,with,no-false-alarm,1.000
clean-invoice,with,seconds,1.000
clean-invoice,with,cost,1.000
clean-invoice,without,no-false-alarm,1.000
clean-invoice,without,seconds,1.000
clean-invoice,without,cost,1.000
duplicate-line,with,asks-before-fix,1.000
duplicate-line,with,lists-both-lines,1.000
duplicate-line,with,seconds,1.000
duplicate-line,with,cost,1.000
duplicate-line,without,asks-before-fix,1.000
duplicate-line,without,lists-both-lines,1.000
duplicate-line,without,seconds,1.000
duplicate-line,without,cost,0.983
```

## Holdout comparison

```
# base
case,arm,grader,runs,passes
rounded-tax,with,cites-line,6,5
rounded-tax,with,no-false-alarm,6,4
rounded-tax,without,cites-line,6,3
rounded-tax,without,no-false-alarm,6,3
currency-mismatch,with,names-currency,6,4
currency-mismatch,without,names-currency,6,2

case,arm,measure,runs,mean
rounded-tax,with,seconds,6,20.0
rounded-tax,with,cost,6,0.080
rounded-tax,without,seconds,6,15.0
rounded-tax,without,cost,6,0.052
currency-mismatch,with,seconds,6,19.0
currency-mismatch,with,cost,6,0.075
currency-mismatch,without,seconds,6,14.3
currency-mismatch,without,cost,6,0.049

# final
case,arm,grader,runs,passes
rounded-tax,with,cites-line,6,6
rounded-tax,with,no-false-alarm,6,4
rounded-tax,without,cites-line,6,3
rounded-tax,without,no-false-alarm,6,3
currency-mismatch,with,names-currency,6,4
currency-mismatch,without,names-currency,6,2

case,arm,measure,runs,mean
rounded-tax,with,seconds,6,20.0
rounded-tax,with,cost,6,0.080
rounded-tax,without,seconds,6,15.0
rounded-tax,without,cost,6,0.052
currency-mismatch,with,seconds,6,19.0
currency-mismatch,with,cost,6,0.075
currency-mismatch,without,seconds,6,14.2
currency-mismatch,without,cost,6,0.049

# permutation p-values, final against base, two-sided
case,arm,name,p
rounded-tax,with,cites-line,1.000
rounded-tax,with,no-false-alarm,1.000
rounded-tax,with,seconds,1.000
rounded-tax,with,cost,1.000
rounded-tax,without,cites-line,1.000
rounded-tax,without,no-false-alarm,1.000
rounded-tax,without,seconds,1.000
rounded-tax,without,cost,0.972
currency-mismatch,with,names-currency,1.000
currency-mismatch,with,seconds,1.000
currency-mismatch,with,cost,0.977
currency-mismatch,without,names-currency,1.000
currency-mismatch,without,seconds,1.000
currency-mismatch,without,cost,1.000
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
