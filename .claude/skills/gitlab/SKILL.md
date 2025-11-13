---
name: gitlab
description: GitLab workflow best practices and glab CLI usage. Use when working with GitLab repositories, merge requests, issues, pipelines, or GitLab API interactions.
---
# GitLab

GitLab workflows use the `glab` CLI tool, the official GitLab command-line interface. This skill helps adapt GitHub (`gh`) patterns to GitLab (`glab`).

## Core Concepts

- **Pull Request → Merge Request (MR)**: GitLab uses "Merge Requests" instead of "Pull Requests"
- **Repository → Project**: GitLab calls repositories "projects"
- **Actions → CI/CD Pipelines**: GitLab uses integrated CI/CD pipelines instead of GitHub Actions

## Command Mappings: gh → glab

### Pull Requests / Merge Requests

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh pr create` | `glab mr create` | Use `--fill` to auto-fill from commits |
| `gh pr list` | `glab mr list` | List merge requests |
| `gh pr view <number>` | `glab mr view <id>` | View MR details |
| `gh pr checkout <number>` | `glab mr checkout <id>` | Checkout MR branch |
| `gh pr merge <number>` | `glab mr merge <id>` | Merge/accept MR |
| `gh pr close <number>` | `glab mr close <id>` | Close MR |
| `gh pr diff <number>` | `glab mr diff <id>` | View MR changes |
| `gh pr comment` | `glab mr note` | Add comment to MR |

### Issues

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh issue create` | `glab issue create` | Create new issue |
| `gh issue list` | `glab issue list` | List issues |
| `gh issue view <number>` | `glab issue view <id>` | View issue details |
| `gh issue close <number>` | `glab issue close <id>` | Close issue |
| `gh issue comment` | `glab issue note` | Add comment to issue |

### Repository / Project

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh repo view` | `glab repo view` | View project details |
| `gh repo clone` | `glab repo clone` | Clone project |
| `gh repo create` | `glab repo create` | Create new project |
| `gh repo fork` | `glab repo fork` | Fork project |

### API Access

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh api <endpoint>` | `glab api <endpoint>` | Make API requests |
| N/A | `glab api graphql` | GraphQL API support |

### CI/CD

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh run list` | `glab ci list` | List pipelines |
| `gh run view <id>` | `glab ci view` | View pipeline details |
| `gh run watch` | `glab ci trace <job-id>` | Watch job logs |
| N/A | `glab ci lint` | Validate `.gitlab-ci.yml` |

## Common Workflows

### Creating a Merge Request

```bash
# Push your branch first
git push -u origin feature-branch

# Create MR with auto-filled details from commits
glab mr create --fill

# Create MR with specific details
glab mr create --title "Fix bug" --description "Description" --label "bugfix"

# Create draft MR
glab mr create --draft --fill

# Continue creation in browser
glab mr create --web
```

### Working with Issues

```bash
# Create issue
glab issue create --title "Bug report" --description "Details"

# Create issue from template
glab issue create

# List my issues
glab issue list --assignee=@me

# View issue
glab issue view 123

# Close issue
glab issue close 123
```

### CI/CD Pipelines

```bash
# List recent pipelines
glab ci list

# View pipeline status for current branch
glab ci status

# Watch job logs in real-time
glab ci trace <job-id>

# Retry a failed job
glab ci retry <job-id>

# Validate CI config
glab ci lint
```

### API Usage

```bash
# REST API - Get project details
glab api projects/:fullpath

# REST API - List issues
glab api projects/:id/issues

# GraphQL API
glab api graphql -f query='
  query {
    currentUser {
      username
      name
    }
  }
'

# Paginated results
glab api issues --paginate
```

## Repository Format

GitLab supports multiple repository formats:
- `OWNER/REPO` - Simple format
- `GROUP/NAMESPACE/REPO` - Full namespace format
- Full URL - `https://gitlab.com/group/namespace/repo`
- Git URL - `git@gitlab.com:group/namespace/repo.git`

Use the `-R` or `--repo` flag to specify a different repository:

```bash
glab mr list -R gitlab-org/gitlab
glab issue list -R group/subgroup/project
```

## Authentication

```bash
# Authenticate with GitLab
glab auth login

# Check authentication status
glab auth status

# Authenticate with token
export GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
```

## Key Differences from GitHub

1. **Terminology**: Pull Requests → Merge Requests, Repository → Project
2. **Namespace Support**: GitLab supports nested groups (`group/subgroup/project`)
3. **Integrated CI/CD**: Built-in pipeline support via `glab ci` commands
4. **GraphQL Support**: First-class GraphQL API support via `glab api graphql`
5. **Draft MRs**: Use `--draft` flag instead of GitHub's draft PR prefix
6. **Squash on Merge**: Use `--squash-before-merge` flag when creating MR

## Best Practices

- Always use `glab` for GitLab operations, not `gh`
- Push branches before creating merge requests: `git push -u origin <branch>`
- Use `--fill` flag to auto-populate MR title and description from commits
- For complex API operations, use `glab api` with GraphQL
- Check pipeline status with `glab ci status` before merging
- Use `glab ci lint` to validate CI configuration locally

## Common Pitfalls

- **Don't** use `gh` commands for GitLab repositories
- **Don't** call merge requests "pull requests" in commands
- **Don't** forget to push your branch before creating an MR
- **Don't** use GitHub Actions syntax - GitLab uses `.gitlab-ci.yml`

## Reference

- [GitLab CLI Documentation](https://docs.gitlab.com/cli/)
- [GitLab API Documentation](https://docs.gitlab.com/api/)
- [GitLab GraphQL API](https://docs.gitlab.com/api/graphql/)
