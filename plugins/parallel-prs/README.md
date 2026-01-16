# parallel-prs

Batch-process multiple issues into draft PRs using parallel worktrees.

## Dependencies

- **worktrunk** (`worktrunk@worktrunk`): Required for worktree management. See [installation instructions](https://worktrunk.dev/#install).

## Usage

Use when:
- Implementing several related issues simultaneously
- Creating multiple PRs in parallel
- Batch-processing a backlog

## Constraints

- **Batch size**: 5 issues max (larger batches split automatically)
- **No worktree cleanup**: PRs may need iteration after CI feedback
- **Issue linking**: `Closes #123` in PR body (not commit)

## Workflow

1. Load `linear`, `github`, or `gitlab` skill; fetch issue details
2. Ask user to clarify ambiguities upfront
3. Plan agents verify paths/line numbers in parallel
4. Create worktrees with `wt switch --create`
5. Implementation agents commit, push, write PR body to `tmp/{branch}/pr-body.md`
6. Parent creates PRs with `--body-file` (subagents cannot use Skill tool)
7. Monitor CI for failures

See [skills/parallel-prs/](skills/parallel-prs/) for detailed documentation.
