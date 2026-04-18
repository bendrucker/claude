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

## Re-request Review

Fires the same mutation as the web UI's "re-request review" button. Re-requests review from a specific reviewer after you've pushed changes addressing their feedback.

```graphql
mutation($projectPath: ID!, $iid: String!, $userId: UserID!) {
  mergeRequestReviewerRereview(input: {
    projectPath: $projectPath,
    iid: $iid,
    userId: $userId
  }) {
    errors
  }
}
```

The `userId` must be a global ID (`gid://gitlab/User/<id>`), not a username. Look up the numeric ID first:

```bash
user_id=$(glab api "users?username=<username>" | jq -r '.[0].id')

glab api graphql \
  -f query='mutation($projectPath: ID!, $iid: String!, $userId: UserID!) { mergeRequestReviewerRereview(input: { projectPath: $projectPath, iid: $iid, userId: $userId }) { errors } }' \
  -F projectPath=$(glab repo view --output json | jq -r '.fullPath') \
  -F iid=<iid> \
  -F userId="gid://gitlab/User/$user_id"
```

**Requirements:**
- Target user must already be a reviewer on the MR
- Caller needs permission to update the MR

**Gotchas:**
- `userId` is typed `UserID!` and expects the full `gid://gitlab/User/<id>` form. Bare numeric IDs or usernames fail with a type error.
- This is a mutation; probing the schema by running it will actually fire the re-request. Use the documented form, don't explore.

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
