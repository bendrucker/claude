---
description: "Fix merge conflicts, commit, and push"
allowed-tools:
  - Read
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - Skill
  - AskUserQuestion
---

# Fix Merge Conflicts

Fix all merge conflicts in the working tree, then commit and push the result.

## Workflow

1. **Load the conflicts skill** via the Skill tool (`git:conflicts`) to get conflict status, context, and resolution tooling.

2. **Initiate merge if needed.** If the skill reports no in-progress conflict operation but upstream divergence exists:
   - Run `git merge origin/<default-branch>` to surface conflicts.
   - If the merge completes cleanly, push and finish.
   - If the merge produces conflicts, proceed to resolution below.
   - Skip this step if a rebase, merge, or cherry-pick is already in progress.

3. **Assess complexity.** After the skill loads, count the conflicted files and conflict markers:
   - **Simple** (all conflicts are in generated files like lockfiles, or fewer than 3 conflicts across 1-2 files with obvious resolutions): proceed without confirmation.
   - **Complex** (3+ files, non-trivial code conflicts, or ambiguous intent): summarize the conflicts and ask the user for confirmation before resolving.

4. **Resolve conflicts.** For each conflicted file:
   - Use three-way access (`:1:`, `:2:`, `:3:` slots via `git show`) to understand base, ours, and theirs.
   - Edit the file to produce the correct merged result.
   - `git add` the resolved file.
   - For generated files (lockfiles, build artifacts), prefer deleting and regenerating over manual merge.

5. **Stash unrelated dirty files.** Before continuing, check for unstaged changes unrelated to the conflicts via `git status --porcelain`.
   - If dirty files exist beyond the resolved conflicts, try `git stash push -m "fix-conflicts: temp" -- <file1> <file2>` with all unrelated dirty files.
   - If stash fails (the sandbox may block unlinking protected files like `.mcp.json`), stash files individually and skip failures. For files that cannot be stashed, hide them temporarily with `git update-index --assume-unchanged <file>`.

6. **Continue the operation.** Run the appropriate continuation command (`git rebase --continue`, `git merge --continue`, or `git cherry-pick --continue`).

7. **Push and restore.** Run `git push` to update the remote branch. Then restore any hidden files with `git update-index --no-assume-unchanged <file>` and run `git stash pop` if anything was stashed.

## Notes

- Follow the project's `CLAUDE.md` for any lockfile-specific guidance (e.g., regenerating `bun.lock` from scratch).
- If a conflict is in a file you don't understand, ask the user rather than guessing.
- Never silently drop changes from either side — when in doubt, keep both and ask.
