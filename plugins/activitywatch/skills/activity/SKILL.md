---
name: activitywatch:activity
description: Report real device usage from ActivityWatch. Covers per-app time, window titles, and active vs idle spans. Use when asked "what apps did I use", "how long was I in X", "what did I work on today", "how much was I active vs idle", or to mine usage patterns for automation.
argument-hint: "[query] [--recent <1d|7d|4w>] [-n <limit>]"
allowed-tools:
  - Bash
  - Read
---

# Activity

Report how the device was actually used, from ActivityWatch's local capture. This skill only reads. It never writes to the db.

ActivityWatch runs `aw-server-rust` in the background (a LaunchAgent supervises it via `aw-qt`). It records the focused app and window title (`aw-watcher-window`) and active vs idle spans (`aw-watcher-afk`) into a SQLite db. DuckDB attaches that db read-only, which is safe while `aw-server` holds its own write connection.

## Database

`~/Library/Application Support/activitywatch/aw-server-rust/sqlite.db`

Override with `AW_DB` (the wrapper resolves it, since DuckDB cannot expand `~` in `ATTACH`). If the file is missing, ActivityWatch is not installed or has not captured yet.

## Querying

Run a named query with `scripts/aw-query.sh`. Each query supports `--recent <duration>` (`12h`, `1d`, `7d`, `4w`) to scope to a recent window, and `-n <limit>` to cap rows.

```bash
${CLAUDE_SKILL_DIR}/scripts/aw-query.sh top-apps
${CLAUDE_SKILL_DIR}/scripts/aw-query.sh top-apps --recent 1d
${CLAUDE_SKILL_DIR}/scripts/aw-query.sh window-titles --recent 7d -n 40
${CLAUDE_SKILL_DIR}/scripts/aw-query.sh afk --recent 1d
```

Durations come back both formatted (`duration`, e.g. `1h 23m`) and raw (`seconds`) so results are readable and still sortable/summable.

## Queries

- **top-apps** — total focused time per app, most first. The headline "what did I use" answer.
- **window-titles** — time per window title within each app. What you were actually doing, not just which app was open. Needs Accessibility granted to ActivityWatch.
- **app-timeline** — focus events in reverse-chronological order (when you switched to what, for how long). Pair with `--recent 1d` to reconstruct a day.
- **afk** — active (`not-afk`) vs idle (`afk`) time. How much of the window was actually at the keyboard.

## Schema

Two tables in the attached `aw` database:

- `buckets(id, name, type, client, hostname, created, data)` — one row per watcher. `type` is `currentwindow` (window watcher) or `afkstatus` (afk watcher).
- `events(id, bucketrow, starttime, endtime, data)` — `bucketrow` joins to `buckets.id`. `starttime`/`endtime` are **nanoseconds since the Unix epoch** (divide by `1e9` for epoch seconds). `data` is JSON: `{app, title}` for `currentwindow`, `{status}` for `afkstatus`.

Duration of an event is `(endtime - starttime) / 1e9` seconds. The named queries live in [`resources/queries/`](resources/queries/).

## Discovery

For questions the named queries don't cover, attach the db read-only and explore. `DESCRIBE` and a sample surface any watcher's shape (browser, editor, and custom watchers all land in `events.data` as JSON):

```bash
duckdb -c "INSTALL sqlite; LOAD sqlite; INSTALL json; LOAD json;
ATTACH '$HOME/Library/Application Support/activitywatch/aw-server-rust/sqlite.db' AS aw (TYPE sqlite, READ_ONLY);
SELECT type, count(*) FROM aw.buckets GROUP BY 1;
DESCRIBE aw.events;
SELECT data FROM aw.events LIMIT 5;"
```

Write ad-hoc queries in the same shape as the files in `resources/queries/`: join `events` to `buckets`, filter by `buckets.type`, extract fields with `json_extract_string(data, '$.field')`, and measure time as `(endtime - starttime) / 1e9`.
