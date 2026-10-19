# Observability

Query Claude Code session history through a DuckDB index over `~/.claude/projects/` transcripts.

## Skills

- [`session`](skills/session): named queries for session search, tool and hook stats, errors, permission rejections, sandbox bypasses, and token usage

The index lives at `${XDG_DATA_HOME:-~/.local/share}/claude-sessions/session.duckdb`, outside `~/.claude` so the folder can be shared on its own. Every table derives from files on disk, so a missing index rebuilds itself on the next refresh.

## Evals

- [`bench`](evals/bench): replays the queries agents run most and times refresh per changed transcript, for performance climbs on the index

## Tests

```bash
bun test plugins/observability/
```
