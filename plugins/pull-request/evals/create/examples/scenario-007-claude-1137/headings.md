---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: github,pull-request: support GitHub stacked pull requests

gh pr merge does not work on a stacked PR, and it is the primary merge path in both babysit's merge mode and pull-request:create, so either would have failed the first time a stack existed on GitHub.

## What changed and why

Stack membership has to be detected through a GraphQL query on pullRequest.stack, since gh pr view has no stack field and gh stack view only reads local tracking state, which a worktree-per-branch layout never has.

## Out of Scope (Deferred, Not Part of This PR)

Checked glab stack and left the GitLab skill untouched: every subcommand is still marked EXPERIMENTAL, with no link, no merge, and no server-side stack object, so the two-layout distinction has nothing to attach to there and the existing custom stack-merge.ts cascade stays the GitLab path.
