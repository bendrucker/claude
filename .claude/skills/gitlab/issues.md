# Issues

Working with GitLab issues via `glab issue`.

## Command Reference: gh issue → glab issue

| GitHub (`gh issue`) | GitLab (`glab issue`) | Notes |
|---------------------|----------------------|-------|
| `gh issue create` | `glab issue create` | Create new issue |
| `gh issue list` | `glab issue list` | List issues |
| `gh issue view <number>` | `glab issue view <id>` | View issue details |
| `gh issue close <number>` | `glab issue close <id>` | Close issue |
| `gh issue reopen <number>` | `glab issue reopen <id>` | Reopen issue |
| `gh issue comment` | `glab issue note` | Add comment to issue |

## Creating Issues

```bash
# With title and description (non-interactive)
glab issue create \
  --title "Bug: Login fails" \
  --description "Steps to reproduce..." \
  --label "bug,high-priority" \
  --assignee "@me"

# Confidential issue
glab issue create \
  --title "Security issue" \
  --description "Details" \
  --confidential

# Link to milestone
glab issue create \
  --title "Feature request" \
  --description "Details" \
  --milestone "v1.0"
```

## Listing and Filtering

```bash
# List all issues
glab issue list

# My assigned issues
glab issue list --assignee=@me

# By label
glab issue list --label=bug

# By state
glab issue list --state=opened
glab issue list --state=closed

# Search by text
glab issue list --search "authentication"
```

## Viewing and Managing

```bash
# View issue details
glab issue view 123

# View in browser
glab issue view 123 --web

# Close issue
glab issue close 123

# Reopen issue
glab issue reopen 123

# Delete issue (careful!)
glab issue delete 123
```

## Commenting

```bash
# Add comment (always use -m flag)
glab issue note 123 -m "This is fixed in !456"
```

## Subscribing

```bash
# Subscribe to issue
glab issue subscribe 123

# Unsubscribe from issue
glab issue unsubscribe 123
```
