---
name: claude-code:changelog
disable-model-invocation: true
description: Review Claude Code release notes for changes relevant to the user's skills, plugins, and tool usage. Use when the user asks "what's new in Claude Code?", "check for updates", "release notes", "new features", "what changed recently?", or wants to stay current with Claude Code.
allowed-tools:
  - Bash(gh api graphql:*)
  - Bash(claude plugin list:*)
---

# Claude Code Changelog Review

**Current version**: `!`claude --version``
**Platform**: `!`uname -s``

**Installed plugins**:
```
!`claude plugin list --json | jq -r '[.[] | select(.enabled) | .id] | unique | .[]'`
```

## Workflow

#### Fetch Releases

Use the GraphQL query at `${CLAUDE_SKILL_DIR}/references/releases.graphql` to fetch releases in a single API call:

```
gh api graphql -F query=@${CLAUDE_SKILL_DIR}/references/releases.graphql -F owner=anthropics -F name=claude-code -F limit=10
```

Variables:
- `$owner` (`String!`): Repository owner
- `$name` (`String!`): Repository name
- `$limit` (`Int!`): Number of releases to fetch. Default 10. Increase if the user asks for a broader range (e.g., "what changed in the last month?").

Response shape: `data.repository.releases.nodes[]` with `tagName`, `publishedAt` (ISO 8601), and `description` (release notes markdown).

Also scan the project's `.claude/` directory for settings, hooks, skills, and rules to understand what's in use.

#### Filter

- **Platform filter**: If Platform is `Darwin`, exclude Windows-only and PowerShell-related entries. If `Linux`, exclude macOS-specific entries.
- **Relevance filter**: Only include entries that connect to the user's installed plugins, project config, or general workflow. Skip entries with no clear connection.

#### Analyze

Categorize each relevant entry and order by impact within each category.

**Features** are major new capabilities that enable workflows that weren't possible before or significantly change how something works. Order by usefulness to this user, not by version. Interactive UX improvements (keyboard shortcuts, search, rendering tweaks) belong in Quality of Life, not Features. Prioritize features for human-interactive use over scripting/machine-use features (e.g., `--bare`, non-blocking MCP) unless the user specifically asks about automation.

**Suggested Uses** must reference the user's actual workflow plugins (e.g., `things`, `linear`, `review:peer`, `pull-request`) with concrete, thoughtful explanations of how the plugin would benefit. Never suggest uses for meta skills (`claude-code:skill`, `claude-code:hook`). If a feature has no concrete application to an installed plugin, omit Suggested Uses entirely.

Only mark a feature 🆕 if it's from a release published **less than 7 days** before today.

#### Present

```
## Features

### Feature Title in Title Case 🆕

**Version:** 1.2.3 (3 days ago)

What the feature does and a concrete explanation of why this user should care.

#### Suggested Uses

* **things:** Store tag mappings in the plugin data directory so they persist across plugin updates, eliminating the need to re-configure after each update.
```

**Bug Fixes, Performance, Quality of Life**: Summarize each category in 2-3 sentences highlighting the most impactful changes. Don't list every entry. Extract what's useful, not mirror the changelog. If the user asks about a specific area, go deeper there.

## Gotchas

- For targeted questions ("did they fix X?"), skip the full categorized output and give a direct answer with the version and release note.
- When the user asks about a specific area ("anything new with skills?"), filter aggressively. Only show entries related to that area.
