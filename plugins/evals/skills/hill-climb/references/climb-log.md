# Climb Log

Keep one log per climb, beside the suite's results and outside version control when the results are. Fill the header before the first run and append a section per candidate as it is decided. A candidate's verdict and the columns it was read against stay in the log after its branch is gone.

```markdown
# `<target>` Climb

## Setup

- Target: `<artifact path>`
- Suite: `<suite path>`, <n> `dev` cases and <n> `holdout` cases, run on <harness>
- Adapter: <`native`, or the adapter module path>
- Base SHA: `<sha>`
- Judge model: <model, or none>
- Spend cap: <amount>

## Columns

| column | results pooled | harness version | model per arm | runs per case |
| --- | --- | --- | --- | --- |
| base | `<path>`, `<path>` | <version> | <model> | <n> a side |

## Candidate <n>

- Branch: `<branch>`
- Hypothesis: <which instruction changes and why the traces say it will help>
- Target graders: `<case>/<grader>`, <arm>, <up or down>
- Guard graders: `<case>/<grader>`, ...
- Columns read: base against `<column>`
- Spend: <amount>
- Verdict: <accept, reject, or stall>, <the starred rows or the reason>
- PR: <link>

## Spend

Running total: <amount> of <cap>
```
