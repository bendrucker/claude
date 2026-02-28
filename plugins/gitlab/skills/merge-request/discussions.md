# Discussions

MR discussions (threaded comments) via `glab api` and the discussions script.

## Discussions Script

`${CLAUDE_SKILL_ROOT}/scripts/discussions.ts` handles fetching, filtering, resolving, and summarizing discussions.

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

## Creating Discussions

Create positioned discussions via the API. Requires diff refs (`base_sha`, `start_sha`, `head_sha`) from `glab api projects/:id/merge_requests/<iid>/versions`.

### Single-line comment

```bash
glab api projects/:id/merge_requests/<iid>/discussions -X POST \
  --input <(jq -n '{
    body: "Comment text",
    position: {
      base_sha: "<base>", start_sha: "<start>", head_sha: "<head>",
      position_type: "text",
      new_path: "src/app.ts",
      new_line: 42
    }
  }') -H "Content-Type: application/json"
```

Use `old_line` instead of `new_line` for deleted lines. Use `old_path` for renamed files.

### Multi-line comment

Add `line_range` to span multiple lines:

```bash
glab api projects/:id/merge_requests/<iid>/discussions -X POST \
  --input <(jq -n '{
    body: "This block needs work",
    position: {
      base_sha: "<base>", start_sha: "<start>", head_sha: "<head>",
      position_type: "text",
      new_path: "src/app.ts",
      new_line: 15,
      line_range: {
        start: {type: "new", new_line: 10},
        end: {type: "new", new_line: 15}
      }
    }
  }') -H "Content-Type: application/json"
```

`line_range.start/end.type` is `"new"` for added lines or `"old"` for removed lines.

### Suggestion

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

## Pitfalls

**Pagination concatenation**: `glab api --paginate` concatenates JSON arrays as `][` across pages, producing invalid JSON. The script handles this automatically with `parseGlabPaginated`, which replaces `][` with `,`.

**Resolution status location**: Check `notes[0].resolved`, not the top-level discussion `resolved` field. The top-level field may not reflect the current state accurately.

**Duplicate threads across diff versions**: When an MR is updated with new commits, GitLab may create new discussion threads for the same file/comment pair across diff versions. Use `--dedupe` to group by file path + body prefix and show only the first occurrence.
