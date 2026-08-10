# Discussions

MR discussions (threaded comments) via `glab api` and the discussions script.

## Discussions Script

`${CLAUDE_SKILL_DIR}/scripts/discussions.ts` handles creating, fetching, filtering, resolving, and summarizing discussions. It fetches diff refs automatically for positioned comments.

### List

```bash
# All discussions as JSON
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid>

# Filter by author
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --author username

# Only review bots
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --bots

# Only unresolved resolvable discussions
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --resolvable --unresolved

# Deduplicate threads across diff versions
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --dedupe

# Compact triage views
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format digest
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format table
```

Three output formats: `json` (default), `digest`, and `table`.

To filter `--author` to yourself, resolve your username with `glab api user 2>/dev/null | jq -r .username`. The `glab api user --jq .username` form returns empty on glab 1.102.0.

`--bots` matches by username shape, since GitLab exposes nothing that marks an account as a bot: a `-bot`/`_bot` suffix, or a `group_<id>_bot_<hash>`/`project_<id>_bot_<hash>` token service account. Bots that break those conventions, and humans whose threads should be treated the same way, go one per line in `$CLAUDE_PLUGIN_DATA/reviewers.txt`.

The script resolves the project from the current directory's git remote. Run it from a checkout of the MR's repo; from an unrelated directory it returns `[]`.

#### JSON output schema

The default (`--format json`) is a flat array of summary objects, one per discussion (the first note of each thread). Not the raw GitLab `{ notes: [...] }` shape, so query the top-level fields directly.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Discussion id, pass to `resolve` |
| `author` | string | Username of the first note's author |
| `body` | string | Full body of the first note |
| `resolved` | boolean | Flattened from `notes[0].resolved` (see Resolution status location) |
| `resolvable` | boolean | Whether the thread can be resolved |
| `file` | string (optional) | Present only for positioned (inline) comments |
| `line` | number (optional) | Present only for positioned (inline) comments |
| `lineRange` | `{ start, end }` or `null` | `null` for single-line and non-positioned comments |

`file` and `line` are omitted entirely for general (non-inline) discussions, so handle them as optional. `lineRange` is always present but `null` unless the comment spans multiple lines.

The summary flattens each thread to its **first note only**. To see the author's replies or the full thread, fetch the raw payload, which keeps every note:

```bash
glab api "projects/:id/merge_requests/<iid>/discussions?per_page=100" 2>/dev/null
```

A GitLab "reply" that is a `changed line in version N` system note (`notes[].system == true`) is not a substantive response. Filter those out before treating a thread as answered.

#### Compact triage

For triage, prefer a compact format over the full JSON. Both truncate each body to `--truncate` characters (default 80); raise it when bodies are clipped too much.

`--format digest` prints one line per discussion: id, location (`file:line`, `file:start-end` for ranges, or `-` when not positioned), resolution state, and a truncated body.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format digest
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format digest --truncate 120
```

`--format table` shows the same fields as bordered columns, plus the author.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format table
```

### Resolve

```bash
# Resolve specific discussions
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts resolve <iid> <discussion-id> [<discussion-id>...]
```

Or directly via the API:

```bash
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=true
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=false
```

### Summary

Shows resolution counts grouped by author:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts summary <iid>
```

### Create

Always use `--body-file` for comment bodies. Piping through echo breaks backtick-heavy markdown due to shell expansion.

```bash
# General discussion (no position)
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --body-file tmp/note.md

# Inline comment on a new line (validated against diff hunks)
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --file src/app.ts --line 42 --body-file tmp/note.md

# Comment on a deleted line
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --file src/app.ts --old-line 10 --body-file tmp/note.md
```

Diff refs are fetched automatically. Positioned comments are validated against diff hunks before posting. If a line is not in the diff, the command exits with the valid line ranges.

### Suggestions

For GitLab's suggestion syntax and its `-N+M` offsets, see [Code Suggestions](review.md#code-suggestions) in review.md. Write the suggestion to a file, then pass it to `create`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --file src/app.ts --line 42 --body-file tmp/suggestion.md
```

## Pitfalls

**Pagination concatenation**: `glab api --paginate` concatenates JSON arrays as `][` across pages, producing invalid JSON. The script handles this with `parseGlabPaginated`, which replaces `][` with `,`.

**Resolution status location**: Check `notes[0].resolved`, not the top-level discussion `resolved` field. The top-level field may not reflect the current state accurately.

**Duplicate threads across diff versions**: When an MR is updated with new commits, GitLab may create new discussion threads for the same file/comment pair across diff versions. Use `--dedupe` to group by file path + body prefix and show only the first occurrence.
