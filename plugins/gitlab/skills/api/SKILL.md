---
name: api
description: GitLab REST and GraphQL API access via glab. Use when making API requests, querying project data, or automating GitLab operations.
---
# GitLab API

REST and GraphQL API access via `glab api`.

## Placeholders

Auto-resolve to current project values:

- `:fullpath` - Full project path (e.g., `group/project`)
- `:id` - Project ID
- `:branch` - Current branch
- `:user` / `:username` - Current user

```bash
glab api projects/:fullpath/merge_requests
```

## REST

```bash
glab api projects/:id/issues                          # GET
glab api projects/:id/issues -X POST -f title="..."   # POST with field
glab api projects/:id/issues --paginate               # All pages
```

## GraphQL

```bash
glab api graphql -f query='{ currentUser { username } }'
```

For pagination, accept `$endCursor` variable and fetch `pageInfo { hasNextPage, endCursor }`.

## Output

- `--output json` (default) - Pretty-printed JSON
- `--output ndjson` - Newline-delimited, works with `jq` streaming

## Documentation

- REST endpoints: `/api/` in [GitLab docs](https://docs.gitlab.com/api/)
- GraphQL schema: `/api/graphql/reference/`
