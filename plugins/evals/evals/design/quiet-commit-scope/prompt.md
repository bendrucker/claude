/evals:design plugins/commits/skills/commit-scope

Write an eval suite for the `commit-scope` skill at `plugins/commits/evals/commit-scope/`, for `claude plugin eval`.

Two kinds of request belong to the skill: `scope` (pick a scope for a new change) and `amend` (fix the scope on an existing subject). Tag each case with its kind.

The trouble is the other direction. After I widened the description, the skill started firing on git work it has no business touching, and rewrote things I never asked about:

> user: write the PR description for this branch
> assistant: (loads commit-scope) `feat(api): add retry cap`
> user: I asked for a PR description, not a subject line

> user: squash these four commits into one
> assistant: (loads commit-scope) `fix(db): handle null totals`
> user: just squash them, don't rename anything

> user: which scope for a change to src/billing/invoice.ts and src/billing/tax.ts
> assistant: `fix(billing): round tax per line`
> user: good

> user: fix the scope on "feat(web): add retry cap", the change is all under src/api
> assistant: `feat(api): add retry cap`
> user: good
