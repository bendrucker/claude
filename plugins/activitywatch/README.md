# ActivityWatch Plugin

Local-first visibility into real device usage for Claude Code, from [ActivityWatch](https://activitywatch.net/).

## Contents

- **Skill `activity`**: report per-app time, window titles, and active vs idle spans from ActivityWatch's local capture.

## How It Works

ActivityWatch runs `aw-server-rust` in the background and records the focused app and window title (`aw-watcher-window`) plus active/idle state (`aw-watcher-afk`) into a SQLite db at `~/Library/Application Support/activitywatch/aw-server-rust/sqlite.db`.

The skill attaches that db read-only with DuckDB, which is safe alongside the running server, and answers usage questions from named queries. No ingest step and no separate index: it reads the live capture directly, the same way the [`atuin-query`](https://github.com/bendrucker/dotfiles) idiom reads shell history.

`scripts/aw-query.sh <query> [--recent <dur>] [-n <limit>]` runs a named query from [`skills/activity/resources/queries/`](skills/activity/resources/queries/):

- `top-apps`: total focused time per app
- `window-titles`: time per window title within each app
- `app-timeline`: focus events in reverse-chronological order
- `afk`: active vs idle time

Override the db path with `AW_DB`.

## Capture Setup

Capture is provisioned separately by the `activitywatch` dotfiles topic: it installs the cask, selects `aw-server-rust`, and autostarts `aw-qt` via a LaunchAgent. Window titles need Accessibility granted to ActivityWatch. This plugin is read-only and assumes capture is already running.
