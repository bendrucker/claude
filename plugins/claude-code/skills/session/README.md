# Session

Search and analyze Claude Code conversation history using a DuckDB index over JSONL session files.

## Contents

- `SKILL.md` - Skill definition with schema docs and usage examples
- `scripts/refresh.ts` - CLI entry point; refreshes the index and prints the DB path
- `scripts/import.ts` - Register an imported machine's corpus and index it under a host label
- `scripts/hosts.ts` - List hosts with their egress policy and re-sync command
- `scripts/forget.ts` - Remove an imported host's rows and synced files
- `scripts/db.ts` - DuckDB index, schema, host enumeration, and query logic
- `resources/schema/` - Table and view definitions (ordered, run on startup)
- `resources/queries/` - Parameterized SQL for built-in queries
- `resources/import.sql` - JSONL parsing and flattening

## Testing

```bash
bun test ./plugins/claude-code/skills/session/scripts/db.test.ts
```

## Inspiration

- [How I Built a Skill That Lets Me Talk to Claude's Conversation Memory](https://alexop.dev/posts/building-conversation-search-skill-claude-code/)
