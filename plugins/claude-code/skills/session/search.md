# Session Search Reference

Advanced options for searching conversation history.

## CLI Options

```
tsx search.ts [query] [options]

Options:
  --digest         Show digest of recent conversations (no query needed)
  --after DATE     Only include conversations after this date
  --before DATE    Only include conversations before this date
  --project PATH   Filter by project path
  --limit N        Maximum results (default: 10 for search, 20 for digest)
  --format FORMAT  Output format: text (default) or json
```

## Date Filtering

Natural language dates:

- `today` - Start of current day
- `yesterday` - Start of yesterday
- `this week` or `week` - 7 days ago

ISO dates work as well: `2024-01-15`

```bash
# Conversations from the last week
tsx search.ts --digest week

# Search only today's sessions
tsx search.ts "error" --after today

# Range query
tsx search.ts "refactor" --after 2024-01-01 --before 2024-01-31
```

## Project Filtering

Filter by project path:

```bash
# Only search in a specific project
tsx search.ts "bug" --project /Users/ben/src/myproject

# Partial path matching works
tsx search.ts "test" --project myproject
```

## JSON Output

Use `--format json` for programmatic access:

```bash
# Pipe search results to jq
tsx search.ts "auth" --format json | jq '.[] | .conversation.summary'

# Get session IDs from digest
tsx search.ts --digest today --format json | jq '.[].sessionId'
```

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
