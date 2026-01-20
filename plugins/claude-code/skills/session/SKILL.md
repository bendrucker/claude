---
name: session
description: View current Claude Code session information including ID, duration, tool usage stats, and log file path. Use when debugging sessions, reviewing activity, or linking to session logs.
allowed-tools: [Bash, Read]
---

# Session Information

Access details about the current Claude Code session.

## Current Session

**Session ID**: `${CLAUDE_SESSION_ID}`

Run the info script to get full session details:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/info.sh "${CLAUDE_SESSION_ID}"
```

## Session File Location

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.

## Manual Queries

Extract specific data with `jq`:

```bash
# Get all tool names used
jq -r '.message.content[]? | select(.type == "tool_use") | .name' SESSION_FILE | sort -u

# Get user messages
jq -r 'select(.type == "user" and .isMeta != true) | .message.content' SESSION_FILE

# Get timestamps
jq -r 'select(.timestamp) | .timestamp' SESSION_FILE | head -1  # start
jq -r 'select(.timestamp) | .timestamp' SESSION_FILE | tail -1  # latest
```

## Session File Structure

Each line is a JSON object with a `type` field:

- `user` - User messages (check `isMeta` for system messages)
- `assistant` - Claude responses with `message.content[]` array
- `progress` - Tool execution progress and hook events
- `summary` - Conversation summaries
- `file-history-snapshot` - File state snapshots
