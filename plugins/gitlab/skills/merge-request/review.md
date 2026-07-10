# MR Reviews

Submit review feedback as draft notes that accumulate before publishing. Comments stay private until bulk-published, mirroring GitHub's pending review workflow.

## Determine the Review Base

Review the MR's actual diff, not whatever a local branch name resolves to. GitLab diffs an MR against the merge-base of its source and target branches. A local `git diff main...HEAD` diverges from that whenever local `main` lags `origin/main`: commits already on `origin/main` but missing from your stale local `main` fall into the range, so the review picks up changes the MR never made (the "bundled changes" false positive).

Fetch first, then diff against the remote tracking ref, never a bare branch name:

```bash
git fetch origin
git diff origin/<target-branch>...HEAD   # three-dot diffs from the merge-base
```

Read `<target-branch>` from `glab mr view <iid>` (usually `main`). For the exact diff GitLab renders, use `glab mr diff <iid>` or the API-fetched refs the script below relies on.

## Draft Notes Script

Always create and anchor inline draft notes through `${CLAUDE_SKILL_DIR}/scripts/draft-note.ts`, never raw `glab api .../draft_notes` calls. The script builds the JSON payload, sets the required `Content-Type`, and fetches diff refs so positioned comments anchor to the right SHAs. Hand-rolling drops the `position` object (the note lands as a summary comment instead of inline) and hits the failures in [API Pitfalls](#api-pitfalls).

### Create

Always use `--body-file` for comment bodies. Piping through echo breaks backtick-heavy markdown due to shell expansion.

```bash
# General comment
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --body-file tmp/note.md

# Inline comment on a new line (validated against diff hunks)
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --file src/app.go --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --file src/app.go --old-line 10 --body-file tmp/note.md

# Reply to existing discussion
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --body-file tmp/note.md

# Reply and resolve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --resolve --body-file tmp/note.md
```

Positioned comments are validated against the MR diff before posting. If a line is not within a diff hunk, the command exits with an error showing the valid line ranges.

### Batch Review

Create multiple draft notes from a JSON file:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json

# Create, publish, and approve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json --submit --approve
```

Input JSON format:

```json
[
  { "file": "src/app.ts", "line": 42, "body": "Consider extracting this." },
  { "file": "src/db.ts", "oldLine": 10, "body": "This was handling errors." },
  { "body": "Overall the approach looks good." }
]
```

Each positioned entry is validated against diff hunks. Failures are reported per-entry without aborting the batch.

### List

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts list <iid>
```

### Submit Review

Publish all draft notes and optionally set a review decision. GitLab's REST API has no atomic "submit review" endpoint, so this runs up to three sequential calls: bulk publish, summary comment, decision.

```bash
# Publish only (equivalent to "Comment" in web UI)
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid>

# Publish with summary comment
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --summary "LGTM, minor nits"

# Publish and approve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --approve

# Publish and request changes (Premium+, uses GraphQL)
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --request-changes

# Full review: summary + approve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --approve --summary-file tmp/review-summary.md
```

The older `publish` command is still available for quick draft publishing without a review decision:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts publish <iid>
```

## Code Suggestions

Use GitLab's suggestion syntax in the note body. Offsets `-N+M` replace N lines above and M lines below the commented line:

````markdown
```suggestion:-0+0
replacement code here
```
````

For multi-line replacements (replace commented line plus 2 below):

````markdown
```suggestion:-0+2
first line
second line
third line
```
````

## API Pitfalls

- **Content-Type required**: `glab api --input <file>` requires `-H "Content-Type: application/json"`. Without it, GitLab returns HTTP 415.
- **No nested `-f` fields**: `glab api -f "position[base_sha]=..."` silently fails. Send nested objects as JSON via `--input`.
- **Reply field**: Use `in_reply_to_discussion_id`, not `discussion_id`.
- **Don't update positioned notes**: PUT to update a draft note strips the position. Delete and recreate instead.
- **No atomic review submit**: The REST API's `bulk_publish` only publishes drafts (no summary comment or review decision). The web UI uses an internal controller that combines all three, but it's session-authenticated only. The `submit` command above sequences the calls separately.
- **Review state is GraphQL-only**: See [review-state.md](review-state.md) for mutations (`mergeRequestRequestChanges`, `mergeRequestDestroyRequestedChanges`) and querying review state. Key: `projectPath` is `ID!` not `String!`, caller must be assigned as reviewer, requires Premium/Ultimate.
- **Range comments need `new_line`**: `line_range` alone is rejected ("position is incomplete"). Set `new_line` to the range end line; the comment anchors there in the UI.

## Discussions

See [discussions.md](discussions.md) for fetching, filtering, resolving, and summarizing MR discussion threads.

## Approvals

```bash
# Approve with SHA safety check (returns 409 if MR updated)
glab api projects/:id/merge_requests/<iid>/approve -X POST -f sha="<head_sha>"

# Unapprove
glab api projects/:id/merge_requests/<iid>/unapprove -X POST
```

## Re-Request Review

GraphQL only (no REST or `glab mr` equivalent). See [review-state.md](review-state.md#re-request-review).
