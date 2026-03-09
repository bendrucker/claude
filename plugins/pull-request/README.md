# pull-request

Create and update pull requests (PRs), merge requests (MRs), and change requests (CRs) with proper formatting and content guidelines.

## Contents

- **Skill**: `pull-request:create` — Create a PR/MR with proper title formatting, body structure, and section organization
- **Skill**: `pull-request:update` — Update a PR/MR body to reflect the current state of changes
- **Skill**: `pull-request:follow-up` — Follow up on review feedback you received: check resolution state, find silent resolves, draft replies
- **Hook**: Validates PR body content before creation or edit

## Worktree Support

Both skills support targeting branches in separate git worktrees. When invoking from a default branch (main/master), specify the target branch as an argument:

```
/pull-request:create feature/my-branch
/pull-request:update feature/my-branch
```

The skills resolve the branch to its worktree path and run git/gh commands there. When already in a feature branch worktree, the argument is optional.
