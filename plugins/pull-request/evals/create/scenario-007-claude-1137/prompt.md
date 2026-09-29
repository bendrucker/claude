Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Adds a new github:stack skill documenting gh stack (the github/gh-stack extension) and wires stacked-PR awareness into babysit's merge mode, pull-request:create, ship, and user/CLAUDE.md, since gh pr merge does not work on a stacked PR and is the primary merge path in both. Covers detection via a GraphQL stack query, two tracking layouts chosen per stack, and merge/re-arm semantics under gh stack merge. 7 files changed, +167/-3.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- gh pr merge does not work on a stacked PR, and it is the primary merge path in both babysit's merge mode and pull-request:create, so either would have failed the first time a stack existed on GitHub.
- Stack membership has to be detected through a GraphQL query on pullRequest.stack, since gh pr view has no stack field and gh stack view only reads local tracking state, which a worktree-per-branch layout never has.
- The first shipped version encoded one-worktree-per-branch as a constraint of the tool itself, which was circular: it was read off the user's own instructions rather than from gh stack's actual behavior.
- Verifying gh stack --help after shipping surfaced three corrections: gh stack sync already does fetch, cascade-rebase, force-with-lease push, and links open PRs into a stack, which in a single-worktree layout replaces both wt sync and gh stack link; gh stack submit opens an editor to draft each PR's title and body, so the create-PR-first workaround is a link-path constraint rather than a general one; and both submit --auto and link create PRs as drafts unless --open is passed, which collides with the ready-for-review default and wasn't mentioned in the first draft.
- Rewrote the skill to document two layouts chosen per stack rather than assuming one: native tracking (gh stack owns branches, rebases, and publish in one working tree) fits a stack under active reshaping, and external tracking (gh stack link only, another tool rebases) fits layers worked on in parallel or over a long stretch.
- A code-review pass raised a blocking finding that gh stack merge <n> could silently merge an unrelated stack if a PR number collided with a stack number; rejected after confirming via gh stack link --help that stack and PR numbers share one sequence per repository and never overlap, so the collision cannot occur.
- gh stack merge is all-or-nothing across every PR at or below the target, so a blocked lower layer sinks the whole call; babysit watches one PR and can't fix a sibling's CI, so that case is reported and the task stops rather than treated as recoverable.
- Checked glab stack and left the GitLab skill untouched: every subcommand is still marked EXPERIMENTAL, with no link, no merge, and no server-side stack object, so the two-layout distinction has nothing to attach to there and the existing custom stack-merge.ts cascade stays the GitLab path.
