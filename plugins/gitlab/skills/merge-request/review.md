# MR Reviews

Submit review feedback as draft notes that accumulate before publishing. Comments stay private until bulk-published — mirrors GitHub's pending review workflow.

## Draft Notes Script

`${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts` handles JSON construction and `glab api` calls. It fetches diff refs automatically when creating positioned comments, avoiding manual SHA management.

### Create

Always use `--body-file` for comment bodies. Piping through echo breaks backtick-heavy markdown due to shell expansion.

```bash
# General comment
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --body-file tmp/note.md

# Inline comment on a new line (validated against diff hunks)
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --file src/app.go --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --file src/app.go --old-line 10 --body-file tmp/note.md

# Reply to existing discussion
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --body-file tmp/note.md

# Reply and resolve
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --resolve --body-file tmp/note.md
```

Positioned comments are validated against the MR diff before posting. If a line is not within a diff hunk, the command exits with an error showing valid line ranges.

### Batch Review

Create multiple draft notes from a JSON file:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts review <iid> --input tmp/review.json

# Create, publish, and approve
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts review <iid> --input tmp/review.json --submit --approve
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
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts list <iid>
```

### Submit Review

Publish all draft notes and optionally set a review decision. GitLab's REST API has no atomic "submit review" endpoint, so this runs up to three sequential calls: bulk publish, summary comment, and decision.

```bash
# Publish only (equivalent to "Comment" in web UI)
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts submit <iid>

# Publish with summary comment
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts submit <iid> --summary "LGTM, minor nits"

# Publish and approve
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts submit <iid> --approve

# Publish and request changes (Premium+, uses GraphQL)
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts submit <iid> --request-changes

# Full review: summary + approve
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts submit <iid> --approve --summary-file tmp/review-summary.md
```

The older `publish` command is still available for quick draft publishing without a review decision:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts publish <iid>
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
- **No nested `-f` fields**: `glab api -f "position[base_sha]=..."` silently fails. Nested objects must be sent as JSON via `--input`.
- **Reply field**: Use `in_reply_to_discussion_id`, not `discussion_id`.
- **Don't update positioned notes**: PUT to update a draft note strips the position. Delete and recreate instead.
- **No atomic review submit**: The REST API's `bulk_publish` only publishes drafts — no summary comment or review decision. The web UI uses an internal controller that combines all three, but it's session-authenticated only. The `submit` command above sequences the calls separately.
- **Request changes is GraphQL-only**: `mergeRequestRequestChanges` mutation, requires Premium/Ultimate.

## Discussions

See [discussions.md](discussions.md) for fetching, filtering, resolving, and summarizing MR discussion threads.

## Approvals

```bash
# Approve (with SHA safety check — returns 409 if MR updated)
glab api projects/:id/merge_requests/<iid>/approve -X POST -f sha="<head_sha>"

# Unapprove
glab api projects/:id/merge_requests/<iid>/unapprove -X POST
```
