# Review State

GitLab's MR review state (`REQUESTED_CHANGES`, `APPROVED`, etc.) is **GraphQL-only**. The REST API exposes reviewer state as `"active"` regardless of the actual review decision.

## Request Changes

```graphql
mutation($projectPath: ID!, $iid: String!) {
  mergeRequestRequestChanges(input: { projectPath: $projectPath, iid: $iid }) {
    mergeRequest { iid }
    errors
  }
}
```

```bash
glab api graphql \
  -f query='mutation($projectPath: ID!, $iid: String!) { mergeRequestRequestChanges(input: { projectPath: $projectPath, iid: $iid }) { mergeRequest { iid } errors } }' \
  -F projectPath=$(glab repo view --output json | jq -r '.fullPath') \
  -F iid=<iid>
```

**Requirements:**
- Premium/Ultimate tier
- Caller must be assigned as a reviewer on the MR (fails with "Reviewer not found" otherwise)

**Common mistake:** `projectPath` is typed `ID!`, not `String!`. Using `String!` causes a type mismatch error.

## Remove Request Changes

```graphql
mutation($projectPath: ID!, $iid: String!) {
  mergeRequestDestroyRequestedChanges(input: { projectPath: $projectPath, iid: $iid }) {
    mergeRequest { iid }
    errors
  }
}
```

## Read Review State

REST `reviewers[].state` only returns `"active"`. Use GraphQL:

```graphql
{
  project(fullPath: "<group/project>") {
    mergeRequest(iid: "<iid>") {
      reviewers {
        nodes {
          username
          mergeRequestInteraction {
            reviewState
          }
        }
      }
    }
  }
}
```

`reviewState` values: `UNREVIEWED`, `REVIEW_STARTED`, `REQUESTED_CHANGES`, `APPROVED`.
