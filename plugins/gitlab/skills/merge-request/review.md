# MR Reviews

Review feedback goes out as draft notes, which only you see until you publish them together, like a GitHub pending review.

## Review Base

Review the diff GitLab shows: source branch against the merge-base with the remote target. Diff against the remote tracking ref, since a stale local `main` pulls commits the MR never made into the range:

```bash
git fetch origin
git diff origin/<target-branch>...HEAD
```

Read `<target-branch>` from `glab mr view <iid>`. `glab mr diff <iid>` prints GitLab's exact diff.

## Draft Notes

Create draft notes with `glab mr note draft create`, which reads the body from stdin and anchors inline notes to the MR's latest diff version. It prints the draft id. Add `-R group/project` to target another repository.

```bash
# General comment
glab mr note draft create <iid> < tmp/note.md

# Inline comment on a new line, or a range
glab mr note draft create <iid> --file src/app.go --line 42 < tmp/note.md
glab mr note draft create <iid> --file src/app.go --line 10:15 < tmp/note.md

# Comment on a deleted line
glab mr note draft create <iid> --file src/app.go --old-line 10 < tmp/note.md

# Reply to a discussion (full id or an 8-character prefix)
glab mr note draft create <iid> --reply <discussion-id> < tmp/note.md
```

`glab mr note draft list`, `update`, and `delete` manage your pending drafts. A reply that also resolves its thread is the one case native `draft create` cannot express. Use a batch entry for it.

### Batch Review

`${CLAUDE_SKILL_DIR}/scripts/draft-note.ts` posts many drafts from one JSON file, then optionally publishes and decides:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json

# Create, publish with a summary, and approve
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json --submit --summary-file tmp/summary.md --approve

# Create, publish, and request changes
bun ${CLAUDE_SKILL_DIR}/scripts/draft-note.ts review <iid> --input tmp/review.json --submit --request-changes
```

```json
[
  { "file": "src/app.ts", "line": 42, "body": "Consider extracting this." },
  { "file": "src/app.ts", "line": "10:15", "body": "This block repeats." },
  { "file": "src/db.ts", "oldLine": 10, "body": "This was handling errors." },
  { "replyTo": "<full-discussion-id>", "resolve": true, "body": "Fixed." },
  { "body": "Overall the approach looks good." }
]
```

Every entry is attempted and failures print per entry. After any failure the script skips publish and approve and exits 1. `--approve`, `--request-changes`, and the summary flags require `--submit`, and `--approve` conflicts with `--request-changes`. `--sha` pins the approval to the reviewed head commit. A `resolve` entry needs the full discussion id, since it goes through REST.

### Publish

`glab mr note draft publish <iid> --yes` publishes every pending draft. `-m <summary>` posts a summary note, and `--reviewer-state requested_changes` sets your review state. GitLab ignores the state when you are the MR author and not a listed reviewer. Neither state is an approval.

```bash
glab mr note draft publish <iid> --yes -m "A few blockers, see the comments." --reviewer-state requested_changes
```

The review is done when `glab mr note draft list <iid>` shows no remaining drafts.

## Code Suggestions

In a note body, `suggestion:-N+M` replaces N lines above through M lines below the commented line:

````markdown
```suggestion:-0+2
first line
second line
third line
```
````

## Approvals

```bash
# Approve, failing if the MR has moved past the reviewed commit
glab mr approve <iid> --sha <head_sha>
glab mr revoke <iid>
```

Review state beyond requesting changes is GraphQL-only, see [review-state.md](review-state.md). For any raw `glab api` call, read [api.md](api.md).
