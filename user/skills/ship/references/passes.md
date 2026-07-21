# Ship Passes

Gating decisions for ship's pre-PR reviews: which pass runs, `review:code` effort, `review:code` versus `simplify`, and why comment trims land the way they do.

## Gating Matrix

Most passes gate on the diff (against the base, plus the working tree). The base is its upstream tracking ref (e.g. `origin/<base>`), not a bare local branch, so a stale local `main` never inflates the file set with already-merged commits. `plan:review` gates on the plan and the session, not the diff (see [Plan Review](#plan-review)).

| Trigger | Pass | Notes |
|---|---|---|
| A substantial plan in context (`~/.claude/plans/` file) and a long or redirected session | `plan:review` | Read-only, non-blocking: background dispatch, joined before create |
| Code changes | `review:code <effort> --fix` or `simplify` | Exactly one. Skip on docs/config-only |
| New code comments | `comments:audit` | See [Comment Trims](#comment-trims) |
| A supported review bot detected for the repo (config fast path, hosted signals otherwise; follow-up's `local.md` owns detection) | `pull-request:follow-up --local` | Reviews committed work, commits its fixes. Runs before the fix passes dirty the tree |
| Prose (`.md`, `.mdx`, `.rst`, docs) | `writing:review` | |
| A runtime surface | `verify` | Declines tests-only and docs-only itself |

Gating is the cost lever: never run a reviewer the change does not warrant. `--skip <pass>` drops any of them (`plan`, `review:code`, `simplify`, `comments`, `bot`, `writing`, `verify`). `code-review` is still accepted for `review:code` so an old invocation does not silently run the pass it meant to skip.

## Plan Review

`plan:review` is the one pass whose trigger is the plan, not the diff, and whose value (an outside-view read of how the implementation drifted from what was approved) only materializes when the session could actually have drifted. So it gates on two things together: a **substantial** approved plan in context, and a session that **ran long or redirected** enough for the diff to wander from it. A small plan executed in a short, direct session is cost without signal, so it skips.

It is read-only and writes nothing, so it runs as a background dispatch rather than a serial pass. The DAG below is the ordering. Its point is to catch fix-worthy drift while the branch is still local, so findings are acted on before create and deferred follow-ups go to the report. No findings is the common outcome, and the join usually adds no wall-clock.

```mermaid
flowchart TD
    S([ship start]) --> G{plan:review gated in?}
    G -->|no| F1[fix passes: comments-audit, local bot, review:code or simplify, writing, verify]
    F1 --> C([create PR])
    G -->|yes| D[dispatch plan:review in background]
    D --> F2[fix passes: comments-audit, local bot, review:code or simplify, writing, verify]
    D -. concurrent .-> R[plan:review reasons over plan + diff]
    F2 --> J{join: findings?}
    R -.-> J
    J -->|fix-worthy drift| A[act before create]
    J -->|none, common| C
    A --> C
```

## Effort Inference

Infer `review:code` effort from the diff unless `--effort` overrides. `high` is routine for risky work. Reserve `max` for explicit requests.

| Diff shape | Effort |
|---|---|
| Tiny: one file, a handful of lines | `low` |
| Ordinary change | `medium` |
| Risky: multiple plugins, hooks, permissions, sandbox, or auth-shaped code | `high` |
| Explicit request only | `max` |

On Opus 4.8, only `max` fans out subagents. `medium`, `high`, and `xhigh` run every angle inline in one context with dedup and no verify pass, so stepping from `medium` to `high` buys two more findings' worth of cap rather than a separate verifier fleet. Budget `--effort high` accordingly and use `max` when a change genuinely warrants independent verification.

`--effort ultra` is not inferrable and `review:code` cannot run it. It is a billed cloud review that only a user-typed `/code-review ultra` can launch. On `--effort ultra`, stop and say so rather than substituting a local level.

## Code-Review Versus Simplify

Alternatives, not a pair. Pick `simplify` for a pure refactor or cleanup with no new behavior: extraction, renaming, dedup, dead-code removal, moving code. It covers reuse, simplification, efficiency, and altitude, and does not hunt bugs. Pick `review:code` for anything with new behavior, a bug fix, or a feature, which need the correctness coverage `simplify` skips. `--simplify` forces the `simplify` path.

## Comment Trims

`comments:audit` commits trims to a fresh `comments/audit-<hash>` branch off `HEAD` via git plumbing, and its apply requires a clean tree. Ship needs the trims on the shipping branch, so it runs the audit first (clean tree) and fast-forwards the shipping branch onto the audit commit. A clean audit writes no branch, so skip the fast-forward when none was printed.

Rejected:

- **`--report` plus inline apply**: pulls the full findings into ship's context, defeating the point of keeping bulk verdicts off the conversation.
- **Running it after `review:code --fix`**: the fix pass dirties the tree, failing `comments:audit`'s clean-tree check.
