# API Access

Using GitLab REST and GraphQL APIs via `glab api`.

## Command Reference: gh api → glab api

| GitHub (`gh api`) | GitLab (`glab api`) | Notes |
|-------------------|---------------------|-------|
| `gh api <endpoint>` | `glab api <endpoint>` | Make REST API requests |
| `gh api graphql` | `glab api graphql` | GraphQL API support |

## REST API

```bash
# Get project details
glab api projects/:fullpath

# List issues
glab api projects/:id/issues

# Get specific issue
glab api projects/:id/issues/123

# With pagination
glab api projects/:id/issues --paginate

# POST request
glab api projects/:id/issues --method POST \
  --field title="Bug report" \
  --field description="Details"
```

## GraphQL API

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

## Placeholders

When using `glab api`, these placeholders auto-resolve to current project values:

- `:fullpath` - Full project path
- `:id` - Project ID
- `:namespace` - Project namespace
- `:repo` - Repository name
- `:user` - Current user
- `:branch` - Current branch

Example:
```bash
glab api projects/:fullpath/merge_requests
```

## Repository Format

Specify repository with `-R` flag:

```bash
# Simple format
glab api projects/:id/issues -R owner/repo

# Full namespace
glab api projects/:id/issues -R group/subgroup/project

# Full URL
glab api projects/:id/issues -R https://gitlab.com/group/project
```

## Best Practices

- **Use placeholders**: `:fullpath` and `:id` work in current project context
- **Prefer GraphQL for complex queries**: More efficient than multiple REST calls
- **Use `--paginate`**: Automatically fetches all pages of results
- **Check response format**: Use `| jq` to parse JSON output
