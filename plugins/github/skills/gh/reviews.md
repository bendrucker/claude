# Pull Request Reviews

Operations not natively supported by the GitHub MCP server.

## Updating Pending Review Comments

```bash
gh api graphql \
  -F query=@query.graphql \
  -f id='PRRC_xxx' \
  -F body=@body.txt
```

With `query.graphql`:

```graphql
mutation UpdatePullRequestReviewComment($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: {pullRequestReviewCommentId: $id, body: $body}) {
    pullRequestReviewComment {
      id
      body
    }
  }
}
```

Use `-F` (not `-f`) with `@` prefix to read file contents. This avoids shell escaping issues with special characters in the body.

The `pull_request_read` MCP tool with `method: get_review_comments` returns comment node IDs in the format `PRRC_xxx`.
