# Review State

MR review state (`UNREVIEWED`, `REVIEW_STARTED`, `REQUESTED_CHANGES`, `APPROVED`) is GraphQL-only. REST reports every reviewer as `"active"`.

These rules apply to every mutation below:

- Type `projectPath` as `ID!`. Read it from `path_with_namespace` in `glab repo view --output json`.
- Pass `iid` with `-f`, since `-F` coerces it to an int and fails against `String!`.
- The caller or target must already be a reviewer on the MR, or the mutation fails with "Reviewer not found".
- Run the documented form as written. Probing the schema runs the mutation for real.

## Request Changes

Premium/Ultimate only.

```bash
glab api graphql \
  -f query='mutation($projectPath: ID!, $iid: String!) { mergeRequestRequestChanges(input: { projectPath: $projectPath, iid: $iid }) { mergeRequest { iid } errors } }' \
  -f projectPath=$(glab repo view --output json | jq -r '.path_with_namespace') \
  -f iid=<iid>
```

To withdraw it, run the same call with `mergeRequestDestroyRequestedChanges`.

## Re-Request Review

The web UI's "re-request review" mutation. `userId` takes `gid://gitlab/User/<id>`, so look up the numeric ID first:

```bash
user_id=$(glab api "users?username=<username>" | jq -r '.[0].id')

glab api graphql \
  -f query='mutation($projectPath: ID!, $iid: String!, $userId: UserID!) { mergeRequestReviewerRereview(input: { projectPath: $projectPath, iid: $iid, userId: $userId }) { errors } }' \
  -f projectPath=$(glab repo view --output json | jq -r '.path_with_namespace') \
  -f iid=<iid> \
  -f userId="gid://gitlab/User/$user_id"
```

Done when `errors` is empty and the reviewer's `reviewState` reads `UNREVIEWED`.

## Read Review State

```graphql
{
  project(fullPath: "<group/project>") {
    mergeRequest(iid: "<iid>") {
      reviewers { nodes { username mergeRequestInteraction { reviewState } } }
    }
  }
}
```

## Review Queue (Cross-Project)

`scripts/review-queue.ts` runs this query and keeps nodes where your own reviewer entry (matching `currentUser.username`) is `UNREVIEWED`:

```graphql
{
  currentUser {
    username
    reviewRequestedMergeRequests(state: opened) {
      nodes {
        reference
        webUrl
        title
        reviewers { nodes { username mergeRequestInteraction { reviewState } } }
      }
    }
  }
}
```

## Review Inbox (Next-Actor Triage)

To triage every MR you review, run the queue query without the `UNREVIEWED` filter and group by your `reviewState`:

| `reviewState` | Next actor |
|---------------|-----------|
| `UNREVIEWED` | You, first review |
| `REVIEW_STARTED` | You, review not yet submitted |
| `REQUESTED_CHANGES` | Author, until they re-request |
| `APPROVED` | Nobody |

The web UI's "Reviewed" label maps to `REVIEW_STARTED` or `REQUESTED_CHANGES`. Triage from `reviewState` rather than the GitLab todos inbox, because re-requests do not reliably create a todo.
