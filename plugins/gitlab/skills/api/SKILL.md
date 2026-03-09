---
name: gitlab:api
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

**Pagination pitfall**: `--paginate` concatenates JSON arrays across pages as `][`, producing invalid JSON (e.g., `[{...}][{...}]`). Fix by replacing `][` with `,` before parsing: `.replace(/\]\s*\[/g, ",")`.

**Nested fields**: `-f` and `--raw-field` silently drop bracket-nested keys like `position[base_sha]=...`. For nested objects, write JSON to a file and use `--input`:

```bash
echo '{"position":{"base_sha":"abc","head_sha":"def","old_path":"file.ts","new_path":"file.ts","position_type":"text","new_line":10}}' > /tmp/payload.json
glab api projects/:id/merge_requests/:iid/discussions -X POST -H "Content-Type: application/json" --input /tmp/payload.json
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
