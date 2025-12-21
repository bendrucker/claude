# Pull Request Workflow

When creating a pull request:

1. If on a default branch, create a branch first, named based on the subject/type of changes:
   - Example: `fix/add-timeout-to-request`
   - Example: `aws-provider-v6`
   - Example: `refactor-user-service`
2. Stage changes if not already staged.
3. Commit if there are no commits yet on the branch. Follow the same format for the commit message as for the pull request title (conventional or subject-oriented based on repo standard).
4. Push the branch to remote.
5. Create the pull request:
   - Write the PR body to a temp file first (e.g., `tmp/pr-body.md`)
   - Use `gh pr create --title "..." --body-file tmp/pr-body.md`
   - This avoids escaping issues with heredocs in shell commands
