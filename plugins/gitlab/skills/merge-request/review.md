# MR Reviews

Review feedback goes out as draft notes, which only you see until you publish them together, like a GitHub pending review.

## Review Base

Review the diff GitLab shows: source branch against the merge-base with the remote target. Diff against the remote tracking ref, since a stale local `main` pulls commits the MR never made into the range:

```bash
git fetch origin
git diff origin/<target-branch>...HEAD
```

Read `<target-branch>` from `glab mr view <iid>`. `glab mr diff <iid>` prints GitLab's exact diff.

## Draft Notes Script

Create and anchor draft notes through `${CLAUDE_SKILL_DIR}/scripts/draft-note.ts`. It builds the JSON payload, sets `Content-Type`, and fetches diff refs so inline notes anchor to the right SHAs. A hand-rolled `glab api .../draft_notes` call drops the `position` object and posts a summary comment instead.

### Create

Pass bodies with `--body-file`, which keeps backtick-heavy markdown away from shell expansion.

```bash
# General comment
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --body-file tmp/note.md

# Inline comment on a new line
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --file src/app.go --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --file src/app.go --old-line 10 --body-file tmp/note.md

# Reply to a discussion, optionally resolving it
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> [--resolve] --body-file tmp/note.md
```

A positioned comment on a line outside the diff hunks exits with an error listing the valid line ranges.

### Batch Review

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json

# Create, publish, and approve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json --submit --approve
```

```json
[
  { "file": "src/app.ts", "line": 42, "body": "Consider extracting this." },
  { "file": "src/db.ts", "oldLine": 10, "body": "This was handling errors." },
  { "body": "Overall the approach looks good." }
]
```

Failures are reported per entry and the rest of the batch still posts.

### List and Submit

`submit` publishes all drafts, then optionally posts a summary and a decision, as up to three calls because REST has no atomic submit. `publish` publishes without a decision.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts list <iid>
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid>
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --summary "LGTM, minor nits"
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --approve --summary-file tmp/review-summary.md
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts submit <iid> --request-changes   # Premium+, GraphQL
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts publish <iid>
```

The review is done when `list` shows no remaining drafts.

## Code Suggestions

In a note body, `suggestion:-N+M` replaces N lines above through M lines below the commented line:

````markdown
```suggestion:-0+2
first line
second line
third line
```
````

## API Pitfalls

For raw `glab api` calls outside the script:

- `glab api --input <file>` needs `-H "Content-Type: application/json"`, or GitLab returns HTTP 415.
- Send nested objects such as `position` as JSON via `--input`. Nested `-f "position[base_sha]=..."` fields silently fail.
- Reply with `in_reply_to_discussion_id`.
- Delete and recreate a positioned draft note to change it. A PUT strips the position.
- A range comment needs `new_line` set to the range end alongside `line_range`, or GitLab rejects it as "position is incomplete".
- Review state is GraphQL-only, see [review-state.md](review-state.md).

## Approvals

```bash
# Approve with SHA safety check (409 if the MR has moved)
glab api projects/:id/merge_requests/<iid>/approve -X POST -f sha="<head_sha>"
glab api projects/:id/merge_requests/<iid>/unapprove -X POST
```
