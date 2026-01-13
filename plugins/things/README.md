# Things Plugin

Interacting with Things 3 task manager for Mac via Claude Code.

## Philosophy

This plugin uses only **public APIs** provided by Cultured Code:

- **URL scheme** (`things:///`) for writes (create, update, reorder)
- **JXA/AppleScript** for reads (queries, filtering, status checks)

Unlike many Things integrations that read or write directly to the SQLite database, this plugin avoids database access entirely. This ensures compatibility with future Things updates and respects the application's data integrity guarantees.

## Features

- Full CRUD operations via official APIs
- List reordering (Today, Anytime, Someday) without SQLite writes
- Type-safe JXA scripting via TypeScript
- Auth token management via macOS Keychain

## Contents

- **Skill**: Comprehensive guidance on JXA scripting and URL scheme usage
- **Scripts**: Reusable automation scripts (`url.js`, `reorder.js`)
