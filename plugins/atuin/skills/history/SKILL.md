---
name: atuin:history
description: Report shell history from atuin's local capture. Covers what commands ran, when, where, and how they exited. Use when asked "what commands did I run", "what was I working on in the terminal", "have I ever run X", "how do I usually invoke X", or about recent shell activity, command frequency, or failed commands.
argument-hint: "[query]"
allowed-tools:
  - Bash
  - Read
---

# Shell History

Report shell activity from atuin's local capture. This skill only reads. Never run subcommands that modify history (`atuin delete`, `atuin search --delete`, `atuin import`).

Arguments are search terms: start with `atuin search $ARGUMENTS`.

## CLI Queries

The default path. `atuin search [query]` prints matching commands, newest first. Useful flags:

- `--after "2 days ago"` / `--before "2026-07-01"`: date bounds, human phrases work
- `-c/--cwd <dir>`: commands run in a directory (`--exclude-cwd` to invert)
- `-e/--exit <code>` / `--exclude-exit <code>`: filter by exit code (`--exclude-exit 0` finds failures)
- `--limit <n>`: cap the result count
- `-r`: oldest first instead of newest first
- `-f/--format '{time} {command}'`: also `{directory}`, `{exit}`, `{duration}`, `{relativetime}`, `{user}`, `{host}`
- `--cmd-only`: bare command text
- `--search-mode <prefix|full-text|fuzzy|skim>`: `full-text` for exact substring matches, overriding the fuzzy default
- `--include-duplicates`: repeated identical commands otherwise collapse to the latest

`atuin stats [today|week|month|year]` aggregates the period: top commands with counts. `-c <n>` sets top-N, `-n 2` counts command pairs (sequences) instead of single commands.

`atuin history list` dumps everything, and takes `--cmd-only` and `-f` too.

## Sandbox

Query subcommands work sandboxed: the sandbox grants writes to `~/.local/share/atuin` because atuin opens its metadata db read-write even for searches. Network subcommands (`atuin status`, `sync`, `login`) fail sandboxed. They are never needed to answer history questions, so don't escalate.

## DuckDB

For aggregations the CLI can't express (frequency by directory, time-bucketed histograms, joins against other data):

```bash
duckdb -c "INSTALL sqlite; LOAD sqlite;
ATTACH '$HOME/.local/share/atuin/history.db' AS atuin (TYPE sqlite, READ_ONLY);
SELECT ...;"
```

Use `$HOME`, not `~` (DuckDB does not expand tildes). `READ_ONLY` is mandatory: the db is WAL-mode with live writers. `INSTALL sqlite` is a local no-op once the extension is cached. A machine without the cache must run it unsandboxed once, since the extension host is not sandbox-reachable.

### Schema

One table, `atuin.history`, one row per invocation:

- `timestamp`: **nanoseconds** since epoch. Convert with `to_timestamp(timestamp / 1e9)`, bound with `timestamp > (epoch(now()) - 86400) * 1e9`
- `duration`: also nanoseconds
- `command`, `cwd`, `exit`, `session`, `hostname`: what ran, where, and how
- `deleted_at`: deletions keep the row. Filter `deleted_at IS NULL`
- `author`, `intent`: agent attribution, populated only when an agent's shell is hooked
