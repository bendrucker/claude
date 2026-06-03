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

The cross-project queue above filters to `UNREVIEWED` and answers "what awaits my first review." The triage read uses the same `reviewRequestedMergeRequests` query but keeps every entry where you are a reviewer, then groups by next actor so you can see what is on your plate versus the author's. Match your reviewer entry the same way the queue does: the reviewer whose `username` equals `currentUser.username`, then read its `reviewState`.

#### Next Actor by Review State

| `reviewState` | Next actor |
|---------------|-----------|
| `UNREVIEWED` | You. The true inbox: awaiting your first review. Maps to the dashboard "Review requests" and [`scripts/review-queue.ts`](scripts/review-queue.ts). |
| `REVIEW_STARTED` | You, mid-review. In progress, not yet submitted. |
| `REQUESTED_CHANGES` | Author's court until they re-request. |
| `APPROVED` | Off your plate. |

The API never returns `REVIEWED`. The web UI label "Reviewed" surfaces as `REVIEW_STARTED` or `REQUESTED_CHANGES` in the API, so a reader who saw "Reviewed" knows the API name.

#### Re-Request Flip-Back

Requesting changes or approving moves the MR out of your `UNREVIEWED` bucket. The author's re-request (the [`mergeRequestReviewerRereview`](#re-request-review) mutation) resets your entry to `UNREVIEWED` and re-surfaces it as a fresh inbox item.

#### Why This Beats the Todos Inbox

A dismissed todo records that you dismissed the notification, not that you handled the review. Re-requests do not reliably regenerate a todo, so the [todos inbox](../todos/SKILL.md) drifts out of sync with the actual review state. `reviewState` is the authoritative per-MR signal.

#### Relation to `review:dashboard`

The `review:dashboard` UNREVIEWED fetch is the spawn-a-session surface for the `UNREVIEWED` row. This triage read is the broader read-and-group view across every state.
