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
- `resources/extensions.sql` - Community extension setup (`markdown`, `yaml`), pulled into a query process via `-init`
- `resources/import.sql` - JSONL parsing and flattening

## Community Extensions

The `plan-sections` and `frontmatter` queries read markdown and YAML from disk through DuckDB's `markdown` and `yaml` community extensions. Run them with `duckdb -readonly -init resources/extensions.sql`, which loads both before the piped query. The index/refresh path needs no extensions.

DuckDB fetches these from `community-extensions.duckdb.org` on first `INSTALL ... FROM community`, then caches them per host under `~/.duckdb/extensions/`. The sandbox blocks network by default, so that host is allowlisted in `user/settings.json` (`WebFetch(domain:community-extensions.duckdb.org)`). Without it, the first install fails with a download error until the extension is cached.

## Testing

```bash
bun test ./plugins/claude-code/skills/session/scripts/db.test.ts
```

## Inspiration

- [How I Built a Skill That Lets Me Talk to Claude's Conversation Memory](https://alexop.dev/posts/building-conversation-search-skill-claude-code/)
