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

## Search History

Search past conversations or get a digest of recent work:

```bash
# Search for specific topics
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search "error handling"

# Get today's conversation digest
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --digest --after today

# Search with date filters
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search "auth" --after yesterday

# Get stats by project for the week
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --stats --after "last week"
```

## Tool Errors

Find tool errors across sessions:

```bash
# List recent tool errors
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --after "last week"

# Only actual failures (not user rejections)
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --type failure

# Only user rejections
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --type rejection

# Aggregate errors by message to find patterns
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --aggregate

# JSON output for further analysis
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --format json

# Filter by tool and extract patterns with jq
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --errors --type failure --format json \
  | jq '[.[] | select(.toolName == "Bash")] | .[].content'
```

## Usage Statistics

Analyze tool usage and project activity:

```bash
# Get overall stats
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --stats

# Stats for a specific project
bun ${CLAUDE_PLUGIN_ROOT}/skills/session/scripts/search --stats --project myproject
```

Stats include:
- Tool usage counts and error rates
- Project session counts and time spent

## Options

- `--after DATE` - Filter by date (e.g., "today", "yesterday", "last week", "2024-01-15")
- `--before DATE` - Filter by date
- `--project PATH` - Filter by project path
- `--limit N` - Maximum results
- `--format FORMAT` - Output format: `text` (default) or `json`
- `--aggregate` - Group errors by message (with `--errors`)
- `--type TYPE` - Filter by error type: `rejection` or `failure` (with `--errors`)

## Session File Location

Session logs are stored in `~/.claude/projects/<encoded-path>/<session-id>.jsonl` where the encoded path replaces `/` with `-`.

## Session File Structure

Each line is a JSON object with a `type` field:

- `user` - User messages (check `isMeta` for system messages)
- `assistant` - Claude responses with `message.content[]` array
- `progress` - Tool execution progress and hook events
- `summary` - Conversation summaries
- `file-history-snapshot` - File state snapshots
