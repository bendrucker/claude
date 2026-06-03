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
  -f projectPath=$(glab repo view --output json | jq -r '.path_with_namespace') \
  -f iid=<iid>
```

**Requirements:**
- Premium/Ultimate tier
- Caller must be assigned as a reviewer on the MR (fails with "Reviewer not found" otherwise)

**Common mistakes:**
- `projectPath` is typed `ID!`, not `String!`. Using `String!` causes a type mismatch error.
- Use `-f` (raw string) for `iid`, not `-F`. `-F` coerces numeric-looking values to int, which fails against `String!`.
- `glab repo view --output json` returns `path_with_namespace`, not `fullPath`.

## Remove Request Changes

```graphql
mutation($projectPath: ID!, $iid: String!) {
  mergeRequestDestroyRequestedChanges(input: { projectPath: $projectPath, iid: $iid }) {
    mergeRequest { iid }
    errors
  }
}
```

## Re-Request Review

Fires the same mutation as the web UI's "re-request review" button.

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

Look up the numeric user ID first, then pass it as the full `gid://gitlab/User/<id>`:

```bash
user_id=$(glab api "users?username=<username>" | jq -r '.[0].id')

glab api graphql \
  -f query='mutation($projectPath: ID!, $iid: String!, $userId: UserID!) { mergeRequestReviewerRereview(input: { projectPath: $projectPath, iid: $iid, userId: $userId }) { errors } }' \
  -f projectPath=$(glab repo view --output json | jq -r '.path_with_namespace') \
  -f iid=<iid> \
  -f userId="gid://gitlab/User/$user_id"
```

**Gotchas:**
- Target user must already be a reviewer on the MR
- `userId` is typed `UserID!`, so bare numeric IDs or usernames fail with a type error
- Probing the schema fires the mutation. Use the documented form, don't explore.

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

## Review Queue (Cross-Project)

The REST queue (`scope=reviews_for_me`) reports every reviewer as `active`, so it cannot tell which MRs you have already approved or sent back. GraphQL's `reviewRequestedMergeRequests` plus per-reviewer `reviewState` is the only way to scope the queue to MRs awaiting your first review.

```graphql
{
  currentUser {
    username
    reviewRequestedMergeRequests(state: opened) {
      nodes {
        reference
        webUrl
        title
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
}
```

Keep nodes where the reviewer whose `username` equals `currentUser.username` has `reviewState === "UNREVIEWED"`. That is the canonical "awaiting my first review" bucket, the analog of GitHub's `gh search prs --review-requested=@me`. [`scripts/review-queue.ts`](scripts/review-queue.ts) runs the query and applies the filter, emitting `[{ url, reference, title }]` as JSON:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/review-queue.ts
```

## Review Inbox (Next-Actor Triage)

The cross-project queue above filters to `UNREVIEWED`. To triage everything you are a reviewer on, run the same `reviewRequestedMergeRequests` query without that filter, match your `username` as the queue does, and group by `reviewState`:

| `reviewState` | Next actor |
|---------------|-----------|
| `UNREVIEWED` | You. Awaiting your first review. |
| `REVIEW_STARTED` | You. Review in progress, not yet submitted. |
| `REQUESTED_CHANGES` | Author, until they re-request. |
| `APPROVED` | Nobody. Off your plate. |

The API never returns `REVIEWED`; the web UI's "Reviewed" label maps to `REVIEW_STARTED` or `REQUESTED_CHANGES`.

A re-request ([`mergeRequestReviewerRereview`](#re-request-review)) resets your entry to `UNREVIEWED` and re-surfaces the MR. Triage off `reviewState` rather than the GitLab todos inbox: a dismissed todo does not mean the review is handled, and re-requests do not reliably regenerate one.
