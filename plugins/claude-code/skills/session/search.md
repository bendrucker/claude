# Session Search Reference

Advanced options for searching conversation history.

## CLI Options

```
bun scripts/search.ts [query] [options]

Options:
  --digest           Show digest of recent conversations (no query needed)
  --stats            Show aggregated statistics grouped by project
  --after DATE       Only include conversations after this date
  --before DATE      Only include conversations before this date
  --project PATH     Filter by project path
  --limit N          Maximum results (default: 10 for search, 20 for digest)
  --format FORMAT    Output format: text (default) or json
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
bun scripts/search.ts --digest --after "last week"

# Search only today's sessions
bun scripts/search.ts "error" --after today

# Range query
bun scripts/search.ts "refactor" --after 2024-01-01 --before 2024-01-31
```

## Project Filtering

Filter by project path:

```bash
# Only search in a specific project
bun scripts/search.ts "bug" --project /Users/ben/src/myproject

# Partial path matching works
bun scripts/search.ts "test" --project myproject
```

## Statistics

Get aggregated statistics by project:

```bash
# Weekly stats by project
bun scripts/search.ts --stats --after "last week"

# Stats for a specific project
bun scripts/search.ts --stats --project myproject
```

Output shows session counts and total minutes per project, sorted by time spent.

## JSON Output

Use `--format json` for programmatic access:

```bash
# Pipe search results to jq
bun scripts/search.ts "auth" --format json | jq '.[] | .conversation.summary'

# Get session IDs from digest
bun scripts/search.ts --digest --after today --format json | jq '.[].sessionId'

# Stats as JSON
bun scripts/search.ts --stats --after "last week" --format json
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
