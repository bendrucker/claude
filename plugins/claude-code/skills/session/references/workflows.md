# Parallel Query Workflows

Worked pattern for fan-out investigations of the session corpus: breadth search for leads, then a depth pass per lead. Read [`SKILL.md`](../SKILL.md) "Parallel Queries (Workflows)" first for the refresh-once/read-only rule this extends.

## Scoping Params From the CLI

`getvariable` returns NULL for an unset variable and every named query null-guards its params, so a bare read-only run of a query file runs unfiltered. Prepend `SET VARIABLE` lines to scope it:

```bash
duckdb -readonly ${CLAUDE_PLUGIN_DATA}/session.duckdb <<'SQL'
SET VARIABLE after_date = '2026-05-01';
SET VARIABLE hook = '*tropes*';
.read ${CLAUDE_SKILL_DIR}/resources/queries/hook-blocks.sql
SQL
```

## Breadth-First Leads

Breadth-first leads come from the survey surfaces (`records` taxonomy, `fields` for schema inference, `activity`, `hooks`, `diagnostics`, `skill-activity`). A depth pass is then custom read-only SQL over whatever table or view the survey pointed at.
