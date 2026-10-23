/evals:hill-climb rules/log-fields.md evals/log-fields

Candidate 1 finished running. Decide it from what's below and tell me why.

## `CLIMB.md`, excerpt

````markdown
# `log-fields` Climb

## Setup

- Target: `rules/log-fields.md`
- Suite: `evals/log-fields`, 3 `dev` cases and 2 `holdout` cases, run on a custom runner that writes per-grader run and pass counts as CSV
- Base SHA: `2c447e9`

## Columns

| column | results pooled | `claude --version` | model |
| --- | --- | --- | --- |
| base | `base-1`, `base-2` | 2.1.230 | claude-sonnet-5-5 |
| candidate | `cand-1`, `cand-2` | 2.1.230 | claude-sonnet-5-5 |

Each results file ran `--tag dev --runs 3`, so each column pools 6 runs a side per case.

## History

Candidate 1 of this climb. Nothing was accepted or rejected before it.

## Candidate 1

Hypothesis: The rule says to log with fields but never names `request_id`, so `includes-request-id` fails on new handlers. Naming the field in the rule should lift it.

Target graders, registered before the run: `add-handler/includes-request-id`, with arm, up.

Guard graders, registered before the run: `cli-script/plain-print-ok`, `error-path/logs-once`.

Holdout: `--tag holdout`, run on the original base and on this candidate as the final commit, 2 replicates of 3 runs a side each.

Holdout: run once on the base and on this candidate as the final commit.
````

## Dev comparison

```
# base
case,arm,grader,runs,passes
add-handler,with,includes-request-id,6,2
add-handler,with,uses-logger,6,5
add-handler,without,includes-request-id,6,1
add-handler,without,uses-logger,6,5
cli-script,with,plain-print-ok,6,6
cli-script,without,plain-print-ok,6,4
error-path,with,logs-once,6,5
error-path,with,redacts-token,6,2
error-path,without,logs-once,6,5
error-path,without,redacts-token,6,3

case,arm,measure,runs,mean
add-handler,with,seconds,6,22.0
add-handler,with,cost,6,0.090
add-handler,without,seconds,6,16.5
add-handler,without,cost,6,0.058
cli-script,with,seconds,6,18.0
cli-script,with,cost,6,0.070
cli-script,without,seconds,6,13.5
cli-script,without,cost,6,0.046
error-path,with,seconds,6,25.0
error-path,with,cost,6,0.110
error-path,without,seconds,6,18.8
error-path,without,cost,6,0.072

# candidate
case,arm,grader,runs,passes
add-handler,with,includes-request-id,6,6
add-handler,with,uses-logger,6,5
add-handler,without,includes-request-id,6,1
add-handler,without,uses-logger,6,5
cli-script,with,plain-print-ok,6,6
cli-script,without,plain-print-ok,6,4
error-path,with,logs-once,6,5
error-path,with,redacts-token,6,2
error-path,without,logs-once,6,5
error-path,without,redacts-token,6,3

case,arm,measure,runs,mean
add-handler,with,seconds,6,22.0
add-handler,with,cost,6,0.090
add-handler,without,seconds,6,16.5
add-handler,without,cost,6,0.059
cli-script,with,seconds,6,18.0
cli-script,with,cost,6,0.070
cli-script,without,seconds,6,13.5
cli-script,without,cost,6,0.046
error-path,with,seconds,6,25.0
error-path,with,cost,6,0.110
error-path,without,seconds,6,18.8
error-path,without,cost,6,0.071

# permutation p-values, candidate against base, two-sided
case,arm,name,p
add-handler,with,includes-request-id,0.060
add-handler,with,uses-logger,1.000
add-handler,with,seconds,1.000
add-handler,with,cost,1.000
add-handler,without,includes-request-id,1.000
add-handler,without,uses-logger,1.000
add-handler,without,seconds,1.000
add-handler,without,cost,1.000
cli-script,with,plain-print-ok,1.000
cli-script,with,seconds,1.000
cli-script,with,cost,1.000
cli-script,without,plain-print-ok,1.000
cli-script,without,seconds,1.000
cli-script,without,cost,1.000
error-path,with,logs-once,1.000
error-path,with,redacts-token,1.000
error-path,with,seconds,1.000
error-path,with,cost,1.000
error-path,without,logs-once,1.000
error-path,without,redacts-token,1.000
error-path,without,seconds,1.000
error-path,without,cost,0.983
```

## Holdout comparison

```
# base
case,arm,grader,runs,passes
new-worker,with,includes-request-id,6,5
new-worker,with,uses-logger,6,4
new-worker,without,includes-request-id,6,3
new-worker,without,uses-logger,6,3
test-helper,with,plain-print-ok,6,4
test-helper,without,plain-print-ok,6,2

case,arm,measure,runs,mean
new-worker,with,seconds,6,20.0
new-worker,with,cost,6,0.080
new-worker,without,seconds,6,15.0
new-worker,without,cost,6,0.052
test-helper,with,seconds,6,19.0
test-helper,with,cost,6,0.075
test-helper,without,seconds,6,14.3
test-helper,without,cost,6,0.049

# final
case,arm,grader,runs,passes
new-worker,with,includes-request-id,6,1
new-worker,with,uses-logger,6,0
new-worker,without,includes-request-id,6,3
new-worker,without,uses-logger,6,3
test-helper,with,plain-print-ok,6,0
test-helper,without,plain-print-ok,6,2

case,arm,measure,runs,mean
new-worker,with,seconds,6,20.0
new-worker,with,cost,6,0.080
new-worker,without,seconds,6,15.0
new-worker,without,cost,6,0.052
test-helper,with,seconds,6,19.0
test-helper,with,cost,6,0.075
test-helper,without,seconds,6,14.2
test-helper,without,cost,6,0.049

# permutation p-values, final against base, two-sided
case,arm,name,p
new-worker,with,includes-request-id,0.085
new-worker,with,uses-logger,0.059
new-worker,with,seconds,1.000
new-worker,with,cost,1.000
new-worker,without,includes-request-id,1.000
new-worker,without,uses-logger,1.000
new-worker,without,seconds,1.000
new-worker,without,cost,0.972
test-helper,with,plain-print-ok,0.059
test-helper,with,seconds,1.000
test-helper,with,cost,0.977
test-helper,without,plain-print-ok,1.000
test-helper,without,seconds,1.000
test-helper,without,cost,1.000
```

Reply once. End the reply with one line: `Decision: accept`, `Decision: reject`, `Decision: more-runs`, `Decision: stall`, `Decision: stop`, or `Decision: re-baseline`.
