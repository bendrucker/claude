# Linear GraphQL API via CLI

Run GraphQL queries and mutations against Linear using the `linear api` CLI subcommand.

## Authentication

Authenticate interactively (persists credentials):

```bash
linear auth login
```

## Usage

Pass a query as an argument:

```bash
linear api 'query { viewer { id name } }'
```

Or pipe from stdin:

```bash
echo '{ viewer { id } }' | linear api
```

Output is JSON on stdout. Pipe through `jq` for formatting or field extraction:

```bash
linear api 'query { viewer { id name email } }' | jq '.data.viewer'
```

## Variables

Simple key-value variables:

```bash
linear api 'query($id: String!) { issue(id: $id) { title } }' --variable id=ISSUE_ID
```

JSON variables for complex inputs:

```bash
linear api 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier } } }' \
  --variables-json '{"input": {"teamId": "TEAM_ID", "title": "Issue title"}}'
```

## Pagination

Use `--paginate` to automatically fetch all pages:

```bash
linear api 'query { issues(first: 50) { nodes { id title } pageInfo { hasNextPage endCursor } } }' --paginate
```

## Example Queries

**Get authenticated user:**

```bash
linear api 'query { viewer { id name email } }'
```

**Get team issues:**

```bash
linear api 'query($teamId: String!) { team(id: $teamId) { issues { nodes { id title url state { name } assignee { name } } } } }' \
  --variable teamId=TEAM_ID
```

**Get user's assigned issues:**

```bash
linear api 'query { viewer { assignedIssues { nodes { id title url state { name } team { key } } } } }'
```

## Example Mutations

**Create issue:**

```bash
linear api 'mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title }
  }
}' --variables-json '{
  "input": {
    "teamId": "TEAM_ID",
    "title": "Issue title",
    "description": "Issue description",
    "stateId": "STATE_ID"
  }
}'
```

**Update issue:**

```bash
linear api 'mutation($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id title state { name } }
  }
}' --variable id=ISSUE_ID --variables-json '{"input": {"stateId": "STATE_ID"}}'
```

## Key Concepts

- **Team IDs**: Required for most operations involving issues and projects
- **State IDs**: Issues default to the team's first Backlog state unless specified
- **Archived Resources**: Hidden by default; use `includeArchived: true` to retrieve
- **Error Handling**: Always check the `errors` array in responses before assuming success
- **Rate Limiting**: Monitor HTTP status codes and handle rate limits appropriately

## Schema Introspection

Discover the API schema:

```bash
linear api '{ __schema { types { name description } } }' | jq '.data.__schema.types[:10]'
```

## Reference

- [Linear GraphQL Documentation](https://linear.app/developers/graphql)
