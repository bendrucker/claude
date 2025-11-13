# Merge Requests

Everything for working with GitLab merge requests via `glab mr`.

## Command Reference: gh pr → glab mr

| GitHub (`gh pr`) | GitLab (`glab mr`) | Notes |
|------------------|-------------------|-------|
| `gh pr create` | `glab mr create` | Use `--fill` to auto-fill from commits |
| `gh pr list` | `glab mr list` | List merge requests |
| `gh pr view <number>` | `glab mr view <id>` | View MR details |
| `gh pr checkout <number>` | `glab mr checkout <id>` | Checkout MR branch |
| `gh pr merge <number>` | `glab mr merge <id>` | Merge/accept MR |
| `gh pr close <number>` | `glab mr close <id>` | Close MR |
| `gh pr diff <number>` | `glab mr diff <id>` | View MR changes |
| `gh pr comment` | `glab mr note` | Add comment to MR |
| `gh pr review` | `glab mr approve <id>` | Approve MR |

## Creating Merge Requests

### Basic Creation

```bash
# 1. Push your branch first (REQUIRED!)
git push -u origin feature-branch

# 2. Create MR with auto-filled details from commits
glab mr create --fill

# 3. Create with specific details
glab mr create \
  --title "Fix authentication bug" \
  --description "Details here" \
  --label "bugfix" \
  --assignee "@me"
```

### Draft Merge Requests

```bash
# Create draft MR
glab mr create --draft --fill

# Or mark as work-in-progress (WIP)
glab mr create --wip --fill
```

### Advanced Options

```bash
# Create MR for an issue
glab mr create --related-issue 123 --fill

# Remove source branch on merge
glab mr create --remove-source-branch --fill

# Squash commits when merging
glab mr create --squash-before-merge --fill

# Assign reviewers
glab mr create --reviewer "@user1,@user2" --fill

# Skip editor prompt
glab mr create --fill --yes
```

## Viewing and Managing

```bash
# List MRs
glab mr list

# Filter by state
glab mr list --state=opened
glab mr list --state=merged

# My MRs
glab mr list --author=@me

# Assigned to me
glab mr list --assignee=@me

# View MR details
glab mr view 123

# View in browser
glab mr view 123 --web

# Check out MR locally
glab mr checkout 123
```

## Reviewing and Approving

```bash
# Approve MR
glab mr approve 123

# Revoke approval
glab mr revoke 123

# Add comment
glab mr note 123 -m "Looks good!"

# View diff
glab mr diff 123
```

## Merging and Closing

```bash
# Merge MR
glab mr merge 123

# Merge and remove source branch
glab mr merge 123 --remove-source-branch

# Close without merging
glab mr close 123

# Reopen closed MR
glab mr reopen 123
```

## Best Practices

- **Always push first**: Run `git push -u origin <branch>` before `glab mr create`
- **Use `--fill`**: Auto-populates title and description from commit messages
- **Enable `--remove-source-branch`**: Keeps repository clean after merge
- **Use `--draft` for WIP**: Prevents accidental merging of incomplete work
- **Link to issues**: Use `--related-issue` to connect MRs to issues

## Common Mistakes

- Forgetting to push the branch before creating MR
- Using `gh pr` commands instead of `glab mr`
- Calling them "pull requests" in command syntax
