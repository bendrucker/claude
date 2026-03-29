---
name: claude-code:session
description: Introspect on your own Claude Code usage and history — session ID, duration, tokens consumed, tool usage patterns, time per project, recent activity summaries, or searching past conversations. Use whenever the user asks about their Claude Code activity ("what's my session ID?", "how many tokens today?", "what did I work on this week?", "find that conversation where I set up X", "am I overusing Bash?"). Do NOT use for general codebase search, git log queries, or arbitrary databases.
allowed-tools:
  - Bash
  - Read
---

# Session

Search and analyze Claude Code conversation history via a DuckDB index over JSONL session files.

**Current Session ID**: `${CLAUDE_SESSION_ID}`

## Running Queries

```bash
QUERY="bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/query.ts"
```

The index refreshes automatically on first use per session. Subsequent queries skip the refresh for faster results. Pass `--refresh` to force a re-scan when the user asks for the latest data.

```bash
$QUERY "SELECT model, SUM(output_tokens) as tokens FROM messages WHERE type = 'assistant' GROUP BY model"
$QUERY --refresh "SELECT * FROM sessions ORDER BY start_time DESC LIMIT 5"
```

#### Named Queries

Built-in queries in `resources/queries/` can be run by name with `key=value` params. Prefer these over writing SQL from scratch for common tasks:

```bash
$QUERY search query=authentication limit=10
$QUERY stats project=myapp after_date=2026-03-15
$QUERY errors error_type=rejection limit=5
```

- `search`: find sessions by keyword (ILIKE on `content_text` and `summary`). Params: `query`, `limit`, `after_date`, `before_date`, `project`
- `stats`: tool usage breakdown with error rates and aggregate totals. Params: `after_date`, `before_date`, `project`
- `errors`: recent tool errors with type filtering. Params: `error_type` (`rejection` or `failure`), `limit`, `after_date`, `before_date`, `project`

## Schema

### `messages` table

One row per message. Schema is auto-detected from JSONL with snake_case renames for known fields.

| Column | Type | Description |
|---|---|---|
| `session_id` | VARCHAR | Session UUID |
| `type` | VARCHAR | `user` or `assistant` |
| `timestamp` | TIMESTAMP | Message timestamp |
| `project_path` | VARCHAR | Absolute path to the project directory |
| `git_branch` | VARCHAR | Branch at time of message |
| `is_meta` | BOOLEAN | System-injected user message (not human input) |
| `content_text` | VARCHAR | Raw text content (string-content messages only) |
| `summary` | VARCHAR | Conversation summary (joined from summary rows) |
| `input_tokens` | BIGINT | Input token count — assistant rows only |
| `output_tokens` | BIGINT | Output token count — assistant rows only |
| `duration_ms` | BIGINT | Message duration in milliseconds |
| `is_sidechain` | BOOLEAN | Whether the message is on a sidechain |
| `source_file` | VARCHAR | Absolute path to the source JSONL file |
| `source_line` | BIGINT | Line number in the source file (1-based) |

Unknown fields from JSONL pass through automatically via `* EXCLUDE`.

### `content_items` table

One row per content array element, with parent context merged in. Schema is fully auto-detected.

| Column | Type | Description |
|---|---|---|
| `type` | VARCHAR | `text`, `tool_use`, `tool_result`, `thinking` |
| `text` | VARCHAR | Text content |
| `name` | VARCHAR | Tool name (for `tool_use`) |
| `id` | VARCHAR | Tool use ID (for `tool_use`) |
| `tool_use_id` | VARCHAR | Matching tool use ID (for `tool_result`) |
| `content` | VARCHAR | Tool result text (for `tool_result`) |
| `is_error` | BOOLEAN | Whether the tool result is an error |
| `session_id` | VARCHAR | Session UUID (from parent message) |
| `timestamp` | VARCHAR | Message timestamp (from parent message) |
| `project_path` | VARCHAR | Project directory (from parent message) |

Additional fields (`input`, `thinking`, `caller`, `signature`, etc.) are auto-detected from real data.

### `sessions` view

Aggregated session-level data.

| Column | Type |
|---|---|
| `session_id` | VARCHAR |
| `summary` | VARCHAR |
| `start_time` | TIMESTAMP |
| `end_time` | TIMESTAMP |
| `duration` | INTERVAL |
| `project_path` | VARCHAR |
| `git_branch` | VARCHAR |
| `user_messages` | BIGINT |
| `assistant_messages` | BIGINT |

### `tool_calls` view

One row per tool use.

| Column | Type |
|---|---|
| `tool_name` | VARCHAR |
| `tool_id` | VARCHAR |
| `session_id` | VARCHAR |
| `project_path` | VARCHAR |
| `timestamp` | TIMESTAMP |

### `tool_errors` view

Tool results where `is_error` is true, joined with the originating tool call.

| Column | Type |
|---|---|
| `tool_id` | VARCHAR |
| `error_content` | VARCHAR |
| `tool_name` | VARCHAR |
| `session_id` | VARCHAR |
| `project_path` | VARCHAR |
| `timestamp` | TIMESTAMP |
| `error_type` | VARCHAR (`rejection` or `failure`) |

### Macros

Reusable filter helpers available in all queries:

- `date_filter(ts, after_val, before_val)`: filters by timestamp range, NULL values bypass the check
- `project_filter(path, project_val)`: ILIKE match on project path, NULL bypasses

## Source Lookup

To retrieve the full JSONL line for a message (e.g., to inspect tool input):

```bash
sed -n '<source_line>p' <source_file>
```

## Session File Structure

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`. The CLI maintains a DuckDB index at `$CLAUDE_PLUGIN_DATA/session.duckdb`, rebuilt incrementally on each invocation.
