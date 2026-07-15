---
name: gitlab:api
description: GitLab REST and GraphQL API access via glab. Use when making API requests, running GraphQL queries or mutations, querying project data, automating GitLab operations, or looking up GitLab feature, API, or CI/CD documentation.
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

#### No `--jq`/`-q`

Output filtering flags belong to `gh api`. Pipe to `jq` instead: `glab api <endpoint> | jq '<filter>'`. Likewise there is no `--json` flag anywhere in glab; use `--output json`.

#### Error Bodies Land on Stdout

A 404/4xx response is a JSON error body (`{"message":"404 Not found"}`), so `glab api ... | jq '.field'` turns the real HTTP error into a misleading jq parse error. When a pipeline fails, rerun the `glab api` call bare and read the body before touching the jq filter.

#### Pagination Pitfall

`--paginate` concatenates JSON arrays across pages as `][`, producing invalid JSON (e.g., `[{...}][{...}]`). Fix by replacing `][` with `,` before parsing: `.replace(/\]\s*\[/g, ",")`.

#### Nested Fields

`-f` and `--raw-field` silently drop bracket-nested keys like `position[base_sha]=...`. For nested objects, write JSON to a file and use `--input`:

```bash
echo '{"position":{"base_sha":"abc","head_sha":"def","old_path":"file.ts","new_path":"file.ts","position_type":"text","new_line":10}}' > /tmp/payload.json
glab api projects/:id/merge_requests/:iid/discussions -X POST -H "Content-Type: application/json" --input /tmp/payload.json
```

## GraphQL

```bash
glab api graphql -f query='{ currentUser { username } }'
```

For pagination, accept `$endCursor` variable and fetch `pageInfo { hasNextPage, endCursor }`.

#### Queries With Variables: Use a Quoted Heredoc

Escaping `$` in an inline `-f query='mutation($var...)'` corrupts the query (GitLab returns `Expected VAR_SIGN, actual: UNKNOWN_CHAR`). A quoted heredoc needs no escaping:

```bash
glab api graphql -f query="$(cat <<'GQL'
mutation($projectPath: ID!, $iid: String!) {
  mergeRequestReviewerRereview(input: { projectPath: $projectPath, iid: $iid, userId: $userId }) { errors }
}
GQL
)" -f projectPath=group/project -f iid=123
```

Pass variables with `-f` (strings), not `-F`: `-F` coerces numeric-looking values to int, and `iid` is typed `String!`. `projectPath` is typed `ID!`, not `String!`.

#### Hallucinated Mutations

Do not guess mutation names from GitHub's schema. `mergeRequestSetAutoMerge` and `mergeRequestRequestReview` are not in GitLab's schema. Auto-merge is REST-only (`glab mr merge --auto-merge`, or the `gitlab:merge-request` skill's merge.ts for merge trains). Re-requesting review is `mergeRequestReviewerRereview`; requesting changes is `mergeRequestRequestChanges`. Probing the schema fires the mutation, so use documented forms only.

## Output

- `--output json` (default) - Pretty-printed JSON
- `--output ndjson` - Newline-delimited, works with `jq` streaming

## Documentation

For `glab` command reference, use `glab <command> --help` instead of web docs (the `/cli/` pages duplicate CLI help output). For everything else, [GitLab docs](https://docs.gitlab.com/) paths:

| Need | Path |
|------|------|
| REST endpoints | `/api/` |
| GraphQL schema | `/api/graphql/reference/` |
| CI/CD YAML syntax | `/ci/yaml/` |
| Predefined CI variables | `/ci/variables/` |
| Feature concepts | `/topics/` |
| UI configuration | `/user/` |
| Self-managed admin | `/administration/` |
