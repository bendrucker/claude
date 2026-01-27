---
name: session
description: View current session info or search conversation history. Use when debugging sessions, reviewing activity, finding past discussions, or summarizing recent work.
allowed-tools: [Bash, Read]
---

# Session Information

Access details about the current Claude Code session or search past conversations.

## Current Session

**Session ID**: `${CLAUDE_SESSION_ID}`

Run the info script to get full session details:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/info.ts "${CLAUDE_SESSION_ID}"
```

## Subcommands

The search CLI supports subcommands: `errors`, `stats`, `digest`, or a search query.

### Search

```bash
# Search for specific topics
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search "error handling"

# Search with date filters
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search "auth" --after yesterday
```

### Digest

```bash
# Get today's conversation digest
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search digest --after today
```

### Errors

```bash
# List recent tool errors
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search errors --after "last week"

# Only actual failures (not user rejections)
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search errors --type failure

# Aggregate errors by message to find patterns
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search errors --aggregate

# Sort by tool name ascending
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search errors --sort tool --order asc

# JSON output for further analysis
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search errors --format json \
  | jq '[.[] | select(.toolName == "Bash")] | .[].content'
```

### Stats

```bash
# Get tool usage stats
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search stats --after "last week"

# Sort by error rate descending
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search stats --sort rate

# Sort by error count ascending (fewest errors first)
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search stats --sort errors --order asc
```

## Common Options

All subcommands support:

- `--after DATE` - Filter by date (e.g., "today", "yesterday", "last week", "2024-01-15")
- `--before DATE` - Filter by date
- `--project PATH` - Filter by project path
- `--limit N` - Maximum results
- `--format FORMAT` - Output format: `text` (default) or `json`

### Errors Options

- `--type TYPE` - Filter by type: `rejection` or `failure`
- `--aggregate` - Group errors by message
- `--sort FIELD` - Sort by: `timestamp` (default) or `tool`
- `--order ORDER` - Sort order: `asc` or `desc` (default)

### Stats Options

- `--sort FIELD` - Sort by: `uses` (default), `errors`, or `rate`
- `--order ORDER` - Sort order: `asc` or `desc` (default)

## Session File Location

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.

## Session File Structure

Each line is a JSON object with a `type` field:

- `user` - User messages (check `isMeta` for system messages)
- `assistant` - Claude responses with `message.content[]` array
- `progress` - Tool execution progress and hook events
- `summary` - Conversation summaries
- `file-history-snapshot` - File state snapshots
