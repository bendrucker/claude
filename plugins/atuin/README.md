# Atuin Plugin

Shell history for Claude Code, from [atuin](https://atuin.sh)'s local capture.

## Contents

- **Skill `history`**: answer "what did I run" questions from atuin's local capture.

## How It Works

Atuin records every shell command (with directory, exit code, duration, and hostname) into a SQLite db at `~/.local/share/atuin/history.db`. The skill queries that capture directly: `atuin search` and `atuin stats` for the common shapes, and a read-only DuckDB `ATTACH` for anything the CLI can't express. No ingest step and no separate index.

## Capture Setup

Capture is provisioned separately by the `atuin` dotfiles topic. This plugin is read-only and assumes capture is already running.

## Curation

`atuin:history` runs only when typed, so the plugin doesn't add to every session's context. Model routing was dropped after three routed calls in the 100 days to 2026-10-16.
