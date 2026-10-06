# Observability

Query Claude Code session history through a DuckDB index over `~/.claude/projects/` transcripts.

## Skills

- [`session`](skills/session): named queries for session search, tool and hook stats, errors, permission rejections, sandbox bypasses, and token usage

The index lives in the plugin data dir, `~/.claude/plugins/data/observability-bendrucker/session.duckdb`. Every table derives from files on disk, so a missing index rebuilds itself on the next refresh.

## Tests

```bash
bun test plugins/observability/
```
