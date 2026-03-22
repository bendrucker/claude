# Session

Search and analyze Claude Code conversation history using a DuckDB index over JSONL session files.

## Contents

- `SKILL.md` - Skill definition with CLI usage examples
- `search.md` - Advanced CLI reference documentation
- `cli/` - TypeScript CLI: `search`, `digest`, `stats`, `errors`
- `resources/schema/` - Table and view definitions (ordered, run on startup)
- `resources/queries/` - Parameterized SQL for each subcommand
- `resources/import.sql` - JSONL parsing and flattening template

## Testing

```bash
bun test ./plugins/claude-code/skills/session/cli/search.test.ts
```

## Inspiration

- [How I Built a Skill That Lets Me Talk to Claude's Conversation Memory](https://alexop.dev/posts/building-conversation-search-skill-claude-code/)
