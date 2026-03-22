---
name: claude-code:session
description: View current session info or search conversation history. Use when debugging sessions, reviewing activity, finding past discussions, or summarizing recent work.
allowed-tools:
  - Bash
  - Read
---

# Session

Search and analyze Claude Code conversation history via a DuckDB index over JSONL session files.

**Current Session ID**: `${CLAUDE_SESSION_ID}`

## Running Queries

```bash
QUERY=${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/query.sh
```

```bash
$QUERY "SELECT model, SUM(output_tokens) as tokens FROM messages WHERE type = 'assistant' GROUP BY model"
$QUERY "SELECT * FROM sessions ORDER BY start_time DESC LIMIT 5"
```

## Schema

### `messages` table

Each row is a content item extracted from a JSONL session line. Assistant messages with array content produce one row per item (text, tool_use, tool_result).

| Column | Type | Description |
|---|---|---|
| `session_id` | VARCHAR | Session UUID |
| `type` | VARCHAR | `user` or `assistant` |
| `timestamp` | VARCHAR | ISO 8601 timestamp |
| `project_path` | VARCHAR | Absolute path to the project directory |
| `git_branch` | VARCHAR | Branch at time of message |
| `is_meta` | BOOLEAN | System-injected user message (not human input) |
| `content_text` | VARCHAR | Raw text content of the message |
| `item_type` | VARCHAR | Content item type: `text`, `tool_use`, `tool_result`, `thinking` |
| `tool_name` | VARCHAR | Tool name (for `tool_use` items) |
| `tool_id` | VARCHAR | Tool use ID (for `tool_use` items) |
| `tool_use_id` | VARCHAR | Matching tool use ID (for `tool_result` items) |
| `result_content` | VARCHAR | Tool result text (for `tool_result` items) |
| `is_error` | BOOLEAN | Whether the tool result is an error |
| `summary` | VARCHAR | Conversation summary (joined from `summary` type rows) |
| `model` | VARCHAR | Model ID (e.g., `claude-opus-4-6`) — assistant rows only |
| `input_tokens` | BIGINT | Input token count — assistant rows only |
| `output_tokens` | BIGINT | Output token count — assistant rows only |
| `stop_reason` | VARCHAR | `end_turn`, `tool_use`, or `max_tokens` — assistant rows only |
| `duration_ms` | BIGINT | Message duration in milliseconds (when available) |
| `version` | VARCHAR | Claude Code version |
| `is_sidechain` | BOOLEAN | Whether the message is on a sidechain (retry/branch) |
| `source_file` | VARCHAR | Absolute path to the source JSONL file |
| `source_line` | BIGINT | Line number in the source file (1-based) |

### `sessions` view

Aggregated session-level data.

| Column | Type |
|---|---|
| `session_id` | VARCHAR |
| `summary` | VARCHAR |
| `start_time` | VARCHAR |
| `end_time` | VARCHAR |
| `duration_minutes` | DOUBLE |
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
| `timestamp` | VARCHAR |

### `tool_errors` view

Tool results where `is_error` is true, joined with the originating tool call.

| Column | Type |
|---|---|
| `tool_id` | VARCHAR |
| `error_content` | VARCHAR |
| `tool_name` | VARCHAR |
| `session_id` | VARCHAR |
| `project_path` | VARCHAR |
| `timestamp` | VARCHAR |
| `error_type` | VARCHAR (`rejection` or `failure`) |

## Source Lookup

To retrieve the full JSONL line for a message (e.g., to inspect tool input):

```bash
sed -n '<source_line>p' <source_file>
```

## Session File Structure

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`. The CLI maintains a DuckDB index at `$CLAUDE_PLUGIN_DATA/session.duckdb`, rebuilt incrementally on each invocation.
