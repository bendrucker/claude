# Command Mappings: gh → glab

Complete reference for translating GitHub CLI commands to GitLab CLI.

## Merge Requests (Pull Requests)

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
| `gh pr review` | `glab mr approve <id>` | Approve MR |

## Issues

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh issue create` | `glab issue create` | Create new issue |
| `gh issue list` | `glab issue list` | List issues |
| `gh issue view <number>` | `glab issue view <id>` | View issue details |
| `gh issue close <number>` | `glab issue close <id>` | Close issue |
| `gh issue reopen <number>` | `glab issue reopen <id>` | Reopen issue |
| `gh issue comment` | `glab issue note` | Add comment to issue |

## Repository / Project

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh repo view` | `glab repo view` | View project details |
| `gh repo clone` | `glab repo clone` | Clone project |
| `gh repo create` | `glab repo create` | Create new project |
| `gh repo fork` | `glab repo fork` | Fork project |

## CI/CD (Actions → Pipelines)

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh run list` | `glab ci list` | List pipelines |
| `gh run view <id>` | `glab ci view` | View pipeline details |
| `gh run watch` | `glab ci trace <job-id>` | Watch job logs in real-time |
| N/A | `glab ci lint` | Validate `.gitlab-ci.yml` |
| N/A | `glab ci status` | View pipeline status for current branch |

## API Access

| GitHub (`gh`) | GitLab (`glab`) | Notes |
|---------------|-----------------|-------|
| `gh api <endpoint>` | `glab api <endpoint>` | Make REST API requests |
| N/A | `glab api graphql` | GraphQL API (first-class support) |

## Repository Format

GitLab supports multiple repository formats:

```bash
# Simple format
glab mr list -R owner/repo

# Full namespace (with groups/subgroups)
glab mr list -R group/subgroup/project

# Full URL
glab mr list -R https://gitlab.com/group/project

# Git URL
glab mr list -R git@gitlab.com:group/project.git
```

## Placeholders in API Calls

When using `glab api`, these placeholders auto-resolve:

- `:fullpath` - Full project path
- `:id` - Project ID
- `:namespace` - Project namespace
- `:repo` - Repository name
- `:user` - Current user
- `:branch` - Current branch

Example:
```bash
glab api projects/:fullpath/issues
```

## Key Differences

1. **Terminology**: Always use "merge request" not "pull request" in `glab` commands
2. **Namespace Support**: GitLab supports nested groups: `group/subgroup/project`
3. **Draft MRs**: Use `--draft` flag (not title prefix like GitHub)
4. **Squash**: Use `--squash-before-merge` when creating MR (not when merging)
5. **GraphQL**: `glab` has built-in GraphQL support via `glab api graphql`
