/evals:hill-climb rules/log-fields.md evals/log-fields

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `log-fields` Climb

## Setup

- Target: `rules/log-fields.md`
- Suite: `evals/log-fields`, 3 `dev` cases and 2 `holdout` cases, run on a custom runner that writes per-grader run and pass counts as CSV
- Base SHA: `886d74a`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1` | 2.1.230 | claude-sonnet-5-5 |

Each column is one results file from `--tag dev --runs 3`, so 3 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The rule says to log with fields but never names `request_id`, so `includes-request-id` fails on new handlers. Naming the field in the rule should lift it.

Target graders, registered before the run: `add-handler/includes-request-id`, with arm, up.

Guard graders, registered before the run: `cli-script/plain-print-ok`, `error-path/logs-once`.

Holdout: not run. The climb is still open and no change has been accepted yet.

Budget: one replicate per column, `--runs 3`.
````

## Dev comparison

```
# base
case,arm,grader,runs,passes
add-handler,with,includes-request-id,3,0
add-handler,with,uses-logger,3,3
add-handler,without,includes-request-id,3,0
add-handler,without,uses-logger,3,3
cli-script,with,plain-print-ok,3,3
cli-script,without,plain-print-ok,3,2
error-path,with,logs-once,3,3
error-path,with,redacts-token,3,1
error-path,without,logs-once,3,3
error-path,without,redacts-token,3,2

case,arm,measure,runs,mean
add-handler,with,seconds,3,21.9
add-handler,with,cost,3,0.089
add-handler,without,seconds,3,16.4
add-handler,without,cost,3,0.058
cli-script,with,seconds,3,17.9
cli-script,with,cost,3,0.070
cli-script,without,seconds,3,13.4
cli-script,without,cost,3,0.045
error-path,with,seconds,3,24.8
error-path,with,cost,3,0.109
error-path,without,seconds,3,18.6
error-path,without,cost,3,0.071

# candidate
case,arm,grader,runs,passes
add-handler,with,includes-request-id,3,3
add-handler,with,uses-logger,3,3
add-handler,without,includes-request-id,3,0
add-handler,without,uses-logger,3,3
cli-script,with,plain-print-ok,3,3
cli-script,without,plain-print-ok,3,2
error-path,with,logs-once,3,3
error-path,with,redacts-token,3,1
error-path,without,logs-once,3,3
error-path,without,redacts-token,3,2

case,arm,measure,runs,mean
add-handler,with,seconds,3,22.4
add-handler,with,cost,3,0.092
add-handler,without,seconds,3,16.8
add-handler,without,cost,3,0.059
cli-script,with,seconds,3,18.3
cli-script,with,cost,3,0.071
cli-script,without,seconds,3,13.7
cli-script,without,cost,3,0.046
error-path,with,seconds,3,25.4
error-path,with,cost,3,0.112
error-path,without,seconds,3,19.1
error-path,without,cost,3,0.073

# permutation p-values, candidate against base, two-sided
case,arm,name,p
add-handler,with,includes-request-id,0.101
add-handler,with,uses-logger,1.000
add-handler,with,seconds,0.699
add-handler,with,cost,0.699
add-handler,without,includes-request-id,1.000
add-handler,without,uses-logger,1.000
add-handler,without,seconds,0.699
add-handler,without,cost,0.699
cli-script,with,plain-print-ok,1.000
cli-script,with,seconds,0.699
cli-script,with,cost,0.699
cli-script,without,plain-print-ok,1.000
cli-script,without,seconds,0.699
cli-script,without,cost,0.699
error-path,with,logs-once,1.000
error-path,with,redacts-token,1.000
error-path,with,seconds,0.699
error-path,with,cost,0.699
error-path,without,logs-once,1.000
error-path,without,redacts-token,1.000
error-path,without,seconds,0.699
error-path,without,cost,0.699
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
