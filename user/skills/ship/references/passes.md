# Ship Passes

The decision matrix ship uses to gate each pre-PR review, infer `code-review`
effort, choose between `code-review` and `simplify`, and land comment trims on
the shipping branch.

## Gating Matrix

Most passes gate on the diff. Read it against the base plus the working tree, and
gate each on what it contains. `plan:review` is the exception: it gates on whether
the session was built against an approved plan.

| Trigger | Pass | Notes |
|---|---|---|
| An approved plan for the session | `plan:review` | Context-gated. See [Plan Review](#plan-review) |
| Code changes | `code-review <effort> --fix` or `simplify` | Exactly one of the two. Skipped on a docs-only or config-only diff |
| New code comments | `comments:audit` | See [Comment Trims](#comment-trims) |
| Prose (`.md`, `.mdx`, `.rst`, docs) | `writing:review` | Prose-gated |
| A runtime surface | `verify` | Skips tests-only and docs-only diffs itself |

The gating is what saves context. A docs-only change skips `code-review` and
`verify`. A code-only change skips `writing:review`. An ad-hoc change with no plan
skips `plan:review`. Never run a reviewer the change does not warrant.

`--skip <pass>` drops any gated pass. `plan`, `code-review`, `simplify`,
`comments`, `writing`, `verify`.

## Plan Review

`plan:review` gates on whether the session was built against an approved plan. Run
it when Claude Code injected one (`~/.claude/plans/<name>.md`) into the session. An
ad-hoc change with no plan has nothing to review against, so skip it.

It is read-only. It forks a clean-context agent over the plan and the diff and
reports divergences, requirements drift, and ranked follow-ups. It writes nothing
to the tree. That is why it runs first, ahead of the fix passes: its follow-ups
frame what the rest of the sequence and the author still need to address, and any
drift fix it prompts then flows through `code-review` and `verify` like the rest of
the change.

Forking a clean context is what the review depends on. The session that built the
change carries a justification for every departure, so drift reads as normal from
inside it. A reviewer starting clean judges the delta on its merits. `plan:review`
owns sourcing the plan and diffing it, so ship only decides whether to run it.

## Effort Inference

`code-review` runs at an inferred effort unless `--effort` overrides it. Session
history spreads fairly evenly across the low three (roughly `low` 63, `medium` 49,
`high` 47), with `max` and `ultra` rare (2 and 0). Match the effort to the diff.
`high` is a routine outcome for risky work. Reserve `max` and `ultra` for explicit
requests.

| Diff shape | Effort |
|---|---|
| Tiny: one file, a handful of lines | `low` |
| Ordinary change | `medium` |
| Risky: touches multiple plugins, hooks, permissions, sandbox, or auth-shaped code | `high` |
| Explicit request only | `max`, `ultra` |

`ultra` is a deep multi-agent cloud review. Never infer it. Run it only when the
user passes `--effort ultra`.

## Code-Review Versus Simplify

They are alternatives, not a pair. Session history bears this out: many runs did
one or the other, few did both. Choose one.

Pick `simplify` when the change is a pure refactor or cleanup with no new
behavior: extraction, renaming, dedup, dead-code removal, moving code without
changing what it does. `simplify` covers reuse, simplification, efficiency, and
altitude. It does not hunt for bugs.

Pick `code-review` for everything else. Any new behavior, bug fix, or feature
needs correctness coverage, which `simplify` does not provide.

`--simplify` forces the `simplify` path regardless of the inference.

## Comment Trims

`comments:audit` does not write to the working tree. It commits its trims to a
fresh `comments/audit-<hash>` branch off `HEAD` via git plumbing, and its apply
step requires a clean working tree. Ship needs those trims on the shipping
branch, not on a side branch.

Resolution: run `comments:audit` as the **first** pre-PR pass, while the tree is
still clean, then fast-forward the shipping branch onto the audit commit.

```
comments:audit --base <base> --fix
git merge --ff-only comments/audit-<hash>
git branch -d comments/audit-<hash>
```

The audit commit is a single commit off the same `HEAD`, so the fast-forward
never conflicts. Ship dispatches the merge to a short-lived `general-purpose`
Agent so ship's own command surface stays limited to `git diff` and `git status`.

A clean audit writes no branch. When `comments:audit` reports nothing to trim,
there is no `comments/audit-<hash>` to merge, so skip the fast-forward rather than
running it against a branch that does not exist.

Two alternatives were rejected:

- **`--report` plus inline apply**: pulls the full findings into ship's context,
  which defeats the whole point of keeping the bulk verdicts on disk and off the
  conversation.
- **Running it after `code-review --fix`**: the fix pass dirties the tree, and
  `comments:audit` apply then fails its clean-tree check. Reordering it first
  avoids a commit step mid-sequence.

Running the audit first also means the later `code-review --fix` pass sees the
already-trimmed comments, which is the better ordering anyway.
