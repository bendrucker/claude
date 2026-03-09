# Calendar Plugin

A Claude Code plugin for reading and managing macOS Calendar events via EventKit.

## Features

- List calendars with source disambiguation (Google, iCloud, etc.)
- Query events by date range with efficient EventKit predicates
- Create, update, and delete events
- JSON output with consistent EventKit identifiers
- Read operations auto-allowed, writes prompt for permission

## Setup

Grant Calendar access to your terminal app in **System Settings → Privacy & Security → Calendars**.

EventKit requires an app bundle context for TCC permissions. It does not work in tmux, SSH, or other environments where the responsible process lacks a bundle ID. Use a direct local terminal session.

## How It Works

A Swift CLI script (`skills/calendar/scripts/cal.swift`) wraps EventKit directly. It runs via `swift` interpretation (~0.3s overhead) with no compilation or dependencies.

See [SKILL.md](skills/calendar/SKILL.md) for command reference.
