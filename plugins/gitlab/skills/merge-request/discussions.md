# Discussions

`${CLAUDE_SKILL_DIR}/scripts/discussions.ts` creates, lists, filters, resolves, and summarizes MR discussion threads. It resolves the project from the current directory's git remote, so run it from a checkout of the MR's repo. Elsewhere it returns `[]`.

## List

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid>                          # JSON
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --author username
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --bots
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --resolvable --unresolved
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --dedupe
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --format digest --truncate 120
```

Formats are `json` (default), `digest`, `table`, and `raw`. Use `digest` or `table` for triage. `digest` prints one line per thread: id, location (`file:line`, `file:start-end`, or `-`), resolution state, and the body truncated to `--truncate` characters (default 80). `table` adds the author.

Resolve your own username for `--author` with `glab api user 2>/dev/null | jq -r .username`. The `--jq .username` form returns empty on glab 1.102.0.

`--bots` matches usernames with a `-bot`/`_bot` suffix, or a `group_<id>_bot_<hash>`/`project_<id>_bot_<hash>` service account. Other accounts to treat as bots go in the plugin's comma-separated `reviewers` option, passed as `--reviewers`.

`--dedupe` collapses the duplicate threads GitLab creates for one comment across diff versions, grouping by file path and body prefix.

#### JSON Output

A flat array with one summary object per thread, built from the thread's first note:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Discussion id, pass to `resolve` |
| `author` | string | First note's author |
| `body` | string | First note's full body |
| `resolved` | boolean | From `notes[0].resolved` |
| `resolvable` | boolean | |
| `file` | string, optional | Inline comments only |
| `line` | number, optional | Inline comments only |
| `lineRange` | `{ start, end }` or `null` | Non-null only for multi-line comments |

To read replies, pass `--format raw`, which prints GitLab's `{ id, notes: [...] }` shape with every note. A note with `system == true` (such as `changed line in version N`) is not a reply. Treat a thread as answered only on a non-system note.

## Resolve and Summarize

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts resolve <iid> <discussion-id> [<discussion-id>...]
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts summary <iid>   # resolution counts by author
```

## Create

Pass bodies with `--body-file`, which keeps backtick-heavy markdown away from shell expansion. Positioned comments are validated against diff hunks, and a line outside them exits with the valid ranges.

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --body-file tmp/note.md
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --file src/app.ts --line 42 --body-file tmp/note.md
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts create <iid> --file src/app.ts --old-line 10 --body-file tmp/note.md
```

For suggestion syntax, see [Code Suggestions](review.md#code-suggestions).

## Raw API

```bash
glab api projects/:id/merge_requests/<iid>/discussions/<id> -X PUT -f resolved=true
```

- `glab api --paginate` joins pages as `][`, which is invalid JSON. Replace `][` with `,` before parsing.
- Read resolution from `notes[0].resolved`. The top-level `resolved` field can be stale.
