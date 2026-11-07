# Discussions

`${CLAUDE_SKILL_DIR}/scripts/discussions.ts` lists, filters, and summarizes MR discussion threads. It targets the checkout's project. Pass `-R group/project` to read an MR elsewhere.

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
| `id` | string | Full discussion id. `digest` and `table` print the first 8 characters, which the native note commands accept |
| `author` | string | First note's author |
| `body` | string | First note's full body |
| `resolved` | boolean | From `notes[0].resolved` |
| `resolvable` | boolean | |
| `file` | string, optional | Inline comments only |
| `line` | number, optional | Inline comments only |
| `lineRange` | `{ start, end }` or `null` | Non-null only for multi-line comments |

To read replies, pass `--format raw`, which prints GitLab's `{ id, notes: [...] }` shape with every note. A note with `system == true` (such as `changed line in version N`) is not a reply. Treat a thread as answered only on a non-system note.

## Summarize

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts summary <iid>   # resolution counts by author
```

## Reply, Resolve, and React

Reply and resolve through the native `glab mr note` commands, which take a full discussion id or a unique prefix of 8 or more characters. `resolve` and `reopen` take the MR first, then the discussion. Send the body on stdin to keep backtick-heavy markdown away from shell expansion.

```bash
glab mr note create <iid> --reply <discussion-id> < tmp/reply.md
glab mr note resolve <iid> <discussion-id>
glab mr note reopen <iid> <discussion-id>
```

Add `-R group/project` to any of them to target another repository. A top-level comment is `glab mr note create <iid> < tmp/note.md`, and an inline one adds `--file <path> --line <n>` (or `--old-line <n>` for a removed line). To reply and resolve inside a pending review, use a `replyTo` entry with `"resolve": true` in a [batch review](review.md#batch-review).

Reactions stay on the REST API:

```bash
glab api projects/:id/merge_requests/<iid>/notes/<note-id>/award_emoji -X POST -f name=thumbsup
```

For suggestion syntax, see [Code Suggestions](review.md#code-suggestions).

## Pitfalls

- Read resolution from `notes[0].resolved`. The top-level `resolved` field can be stale.
- For other raw API calls, including pagination, see [api.md](api.md).
