# Discussions

MR discussions (threaded comments) via `glab api` and the discussions script.

## Discussions Script

`${CLAUDE_SKILL_ROOT}/scripts/discussions.ts` handles creating, fetching, filtering, resolving, and summarizing discussions. It fetches diff refs automatically for positioned comments.

### List

```bash
# All discussions as JSON
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts list <iid>

# Filter by author
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts list <iid> --author username

# Only unresolved resolvable discussions
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts list <iid> --resolvable --unresolved

# Deduplicate threads across diff versions
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts list <iid> --dedupe

# Table output
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts list <iid> --format table
```

### Resolve

```bash
# Resolve specific discussions
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts resolve <iid> <discussion-id> [<discussion-id>...]

# Resolve all by a specific author
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts resolve <iid> --all-by username

# Unresolve
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts resolve <iid> <discussion-id> --unresolve
```

Or directly via the API:

```bash
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=true
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=false
```

### Summary

Shows resolution counts grouped by author:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts summary <iid>
```

### Create

Always use `--body-file` for comment bodies. Piping through echo breaks backtick-heavy markdown due to shell expansion.

```bash
# General discussion (no position)
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts create <iid> --body-file tmp/note.md

# Inline comment on a new line (validated against diff hunks)
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts create <iid> --file src/app.ts --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts create <iid> --file src/app.ts --old-line 10 --body-file tmp/note.md
```

Diff refs are fetched automatically. Positioned comments are validated against diff hunks before posting — if a line is not in the diff, the command exits with valid line ranges.

### Suggestions

Use GitLab's suggestion syntax in the body. The `-N+M` offset replaces N lines above and M lines below the commented line:

````markdown
```suggestion:-0+0
replacement code
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

Combine with the `create` command by writing the suggestion to a file first:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/discussions.ts create <iid> --file src/app.ts --line 42 --body-file tmp/suggestion.md
```

## Pitfalls

**Pagination concatenation**: `glab api --paginate` concatenates JSON arrays as `][` across pages, producing invalid JSON. The script handles this automatically with `parseGlabPaginated`, which replaces `][` with `,`.

**Resolution status location**: Check `notes[0].resolved`, not the top-level discussion `resolved` field. The top-level field may not reflect the current state accurately.

**Duplicate threads across diff versions**: When an MR is updated with new commits, GitLab may create new discussion threads for the same file/comment pair across diff versions. Use `--dedupe` to group by file path + body prefix and show only the first occurrence.
