---
name: claude-code:session
description: View current session info or search conversation history. Use when debugging sessions, reviewing activity, finding past discussions, or summarizing recent work.
allowed-tools: [Bash, Read]
---

# Session CLI

Search and analyze Claude Code conversation history.

**Current Session ID**: `${CLAUDE_SESSION_ID}`

## Commands

```bash
CLI=${CLAUDE_PLUGIN_ROOT}/skills/session/cli
```

### digest

List recent sessions with summaries.

```bash
# Today's sessions
bun $CLI digest --after today

# View the current session
bun $CLI digest --session $CLAUDE_SESSION_ID

# JSON output for piping
bun $CLI digest --after today --format json | jq '.[].sessionId'
```

### search

Search conversations by keyword.

```bash
bun $CLI search "error handling"
bun $CLI search "auth" --after yesterday
```

### stats

Show tool usage statistics.

```bash
bun $CLI stats --after "last week"
bun $CLI stats --sort rate  # Sort by error rate
```

### errors

List tool errors.

```bash
bun $CLI errors --after "last week"
bun $CLI errors --type failure  # Exclude user rejections
bun $CLI errors --aggregate     # Group by error message
```

## Common Options

- `--after DATE` - Filter by date (e.g., "today", "yesterday", "last week")
- `--before DATE` - Filter by date
- `--project PATH` - Filter by project path
- `--limit N` - Maximum results
- `--format FORMAT` - Output format: `text` (default) or `json`
- `--log-level LEVEL` - Telemetry output: `debug` (logs) or `trace` (logs + spans)
- `--log-file PATH` - Write traces and logs to a JSONL file

## Direct Session Inspection

For deeper inspection of a single session, use jq directly:

```bash
# Session file path pattern
FILE=~/.claude/projects/-Users-ben-src-project/$CLAUDE_SESSION_ID.jsonl

# List all tool uses
jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name' < "$FILE"

# Get the session summary
jq -r 'select(.type == "summary") | .summary' < "$FILE"

# Count message types
jq -r '.type' < "$FILE" | sort | uniq -c
```

## Session File Structure

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.

Each line is a JSON object with a `type` field:

- `user` - User messages (check `isMeta` for system messages)
- `assistant` - Claude responses with `message.content[]` array
- `progress` - Tool execution progress and hook events
- `summary` - Conversation summaries
