# Pull Request Workflow

When creating a pull request:

1. Create a pull request from staged changes and any recent commits to the current branch if not on a default branch.
2. Exclude all unstaged changes.
3. If on a default branch, create a branch first, named based on the subject/type of changes:
   - Example: `fix/add-timeout-to-request`
   - Example: `aws-provider-v6`
   - Example: `refactor-user-service`
4. Commit first if there are no staged changes. Follow the same format for the commit message as for the pull request title.
5. When done, after summarizing the pull request URL, checkout the default branch.
