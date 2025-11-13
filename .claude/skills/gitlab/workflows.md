# GitLab Workflows

Common workflows and examples for working with GitLab via `glab` CLI.

## Creating Merge Requests

### Basic MR Creation

```bash
# 1. Push your branch first (required!)
git push -u origin feature-branch

# 2. Create MR with auto-filled details from commits
glab mr create --fill

# 3. Create with specific details
glab mr create --title "Fix authentication bug" \
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

# Continue creation in browser
glab mr create --web
```

## Working with Issues

### Creating Issues

```bash
# Interactive creation
glab issue create

# With details
glab issue create \
  --title "Bug: Login fails" \
  --description "Steps to reproduce..." \
  --label "bug,high-priority" \
  --assignee "@me"

# Confidential issue
glab issue create --confidential
```

### Listing and Filtering

```bash
# List all issues
glab issue list

# My assigned issues
glab issue list --assignee=@me

# By label
glab issue list --label=bug

# Open issues only
glab issue list --state=opened
```

### Managing Issues

```bash
# View issue details
glab issue view 123

# Close issue
glab issue close 123

# Reopen issue
glab issue reopen 123

# Add comment
glab issue note 123 -m "This is fixed in !456"
```

## CI/CD Pipelines

### Viewing Pipelines

```bash
# List recent pipelines
glab ci list

# Pipeline status for current branch
glab ci status

# View specific pipeline
glab ci view
```

### Working with Jobs

```bash
# Watch job logs in real-time
glab ci trace <job-id>

# Retry a failed job
glab ci retry <job-id>

# Trigger manual job
glab ci trigger <job-id>
```

### Validating Configuration

```bash
# Lint .gitlab-ci.yml file
glab ci lint

# Lint specific file
glab ci lint --path custom-ci.yml
```

## API Usage

### REST API

```bash
# Get project details
glab api projects/:fullpath

# List issues
glab api projects/:id/issues

# Get specific issue
glab api projects/:id/issues/123

# With pagination
glab api projects/:id/issues --paginate
```

### GraphQL API

```bash
# Simple query
glab api graphql -f query='
  query {
    currentUser {
      username
      name
    }
  }
'

# Project query
glab api graphql -f query='
  query {
    project(fullPath: "group/project") {
      name
      forksCount
      issuesEnabled
    }
  }
'

# With variables and pagination
glab api graphql --paginate -f query='
  query($endCursor: String) {
    project(fullPath: "group/project") {
      issues(first: 10, after: $endCursor) {
        edges {
          node {
            title
            state
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
'
```

## Authentication

### Initial Setup

```bash
# Interactive login
glab auth login

# Login with token
glab auth login --hostname gitlab.com --token glpat-xxxxxxxxxxxx

# For self-hosted GitLab
glab auth login --hostname gitlab.example.com
```

### Managing Authentication

```bash
# Check auth status
glab auth status

# Use environment variable
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
```

## Repository Operations

### Cloning

```bash
# Clone project
glab repo clone group/project

# Clone from specific group
glab repo clone -g mygroup

# Clone and cd into directory
glab repo clone group/project -- --recurse-submodules
```

### Creating Projects

```bash
# Create project
glab repo create my-project

# With description and visibility
glab repo create my-project \
  --description "My awesome project" \
  --visibility private
```

### Forking

```bash
# Fork project
glab repo fork group/project

# Fork to specific namespace
glab repo fork group/project --target-namespace my-group
```

## Best Practices

1. **Always push before creating MR**: `git push -u origin <branch>` then `glab mr create`
2. **Use `--fill` flag**: Auto-populates title/description from commits
3. **Validate CI locally**: Run `glab ci lint` before pushing
4. **Check pipeline status**: Use `glab ci status` before merging
5. **Use GraphQL for complex queries**: More efficient than multiple REST calls
6. **Leverage placeholders**: Use `:fullpath`, `:id` in API calls for current project
