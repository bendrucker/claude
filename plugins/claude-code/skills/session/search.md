# Session CLI Reference

Advanced options for searching and analyzing conversation history.

## Commands

```
bun cli <command> [options]

Commands:
  search <query>   Search conversations by keyword
  digest           List recent sessions with summaries
  stats            Show tool usage statistics
  errors           List tool errors
```

Empty sessions (started but no messages sent) are filtered out automatically.

## Date Filtering

Uses [chrono-node](https://github.com/wanasit/chrono) for natural language date parsing:

- `today`, `yesterday`
- `last week`, `2 days ago`, `last month`
- `January 15`, `Jan 15 2024`
- ISO dates: `2024-01-15`

```bash
# Conversations from the last week
bun cli digest --after "last week"

# Search only today's sessions
bun cli search "error" --after today

# Range query
bun cli search "refactor" --after 2024-01-01 --before 2024-01-31
```

## Project Filtering

Filter by project path:

```bash
# Only search in a specific project
bun cli search "bug" --project /Users/ben/src/myproject

# Partial path matching works
bun cli search "test" --project myproject
```

## Single Session

View details for a specific session:

```bash
# By session ID
bun cli digest --session abc-123-def

# Current session (using environment variable)
bun cli digest --session $CLAUDE_SESSION_ID
```

## Statistics

Get aggregated tool usage statistics:

```bash
# Weekly stats
bun cli stats --after "last week"

# Stats for a specific project
bun cli stats --project myproject

# Sort by error rate
bun cli stats --sort rate
```

## Errors

List tool errors with filtering options:

```bash
# Recent errors
bun cli errors --after "last week"

# Only actual failures (exclude user rejections)
bun cli errors --type failure

# Group by error message to find patterns
bun cli errors --aggregate

# Sort by tool name
bun cli errors --sort tool --order asc
```

## JSON Output

Use `--format json` for programmatic access:

```bash
# Pipe search results to jq
bun cli search "auth" --format json | jq '.[] | .conversation.summary'

# Get session IDs from digest
bun cli digest --after today --format json | jq '.conversations[].sessionId'

# Filter errors by tool
bun cli errors --format json | jq '[.[] | select(.toolName == "Bash")]'
```

### JSON Fields

The JSON output includes computed fields for convenience:

- `projectName` - Last component of projectPath (e.g., "api" from "/Users/ben/src/api")
- `durationMinutes` - Pre-computed session duration in minutes

## Relevance Scoring

Search results are ranked by relevance with weighted scoring:

| Source | Weight |
|--------|--------|
| Summary | 3.0x |
| User messages | 1.5x |
| Tool usage | 1.3x |
| Assistant messages | 1.0x |

This prioritizes conversations where your query matches the summary or your own prompts.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_PROJECTS_DIR` | Override default `~/.claude/projects/` path |
