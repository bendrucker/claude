# MR Reviews

Submit review feedback as draft notes that accumulate before publishing. Comments stay private until bulk-published — mirrors GitHub's pending review workflow.

## Draft Notes Script

`${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts` handles JSON construction and `glab api` calls. It fetches diff refs automatically when creating positioned comments, avoiding manual SHA management.

### Create

Write body to a file, then pipe or pass via `--body-file`:

```bash
# General comment
echo "Looks good overall" | bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid>

# Inline comment on a new line
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --file src/app.go --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --file src/app.go --old-line 10 --body-file tmp/note.md

# Multi-line comment
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --file src/app.go --line-start 10 --line-end 15 --body-file tmp/note.md

# Reply to existing discussion
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --body-file tmp/note.md

# Reply and resolve
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts create <iid> --reply-to <discussion-id> --resolve --body-file tmp/note.md
```

### List and Publish

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/draft-note.ts list <iid>
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

## Discussions

```bash
# List all discussions
glab api projects/:id/merge_requests/<iid>/discussions --paginate

# Resolve/unresolve a thread
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=true
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=false
```

## Approvals

```bash
# Approve (with SHA safety check — returns 409 if MR updated)
glab api projects/:id/merge_requests/<iid>/approve -X POST -f sha="<head_sha>"

# Unapprove
glab api projects/:id/merge_requests/<iid>/unapprove -X POST
```
