---
name: claude-code:changelog
description: Review the Claude Code CHANGELOG for recent additions relevant to the user's skills, plugins, and tool usage. Use when the user asks "what's new in Claude Code?", "any relevant changelog updates?", "what changed recently?", or wants to stay current with Claude Code features that affect their workflow.
allowed-tools:
  - WebFetch(domain:raw.githubusercontent.com)
  - Bash(claude plugin list:*)
  - Bash(bun ${CLAUDE_PLUGIN_DIR}/skills/session/scripts/query.ts:*)
---

# Claude Code Changelog Review

**Current version**: `!`claude --version``

Surface Claude Code changelog entries relevant to the user's installed plugins, skills, and tool usage patterns.

## Workflow

### Fetch Changelog

Fetch the changelog with WebFetch from `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`. Focus on the **two most recent versions** unless the user asks for a different range.

### Gather Context

Run these in parallel to understand the user's setup:

- **Installed plugins**: Run `claude plugin list --json` to get all installed plugins with their IDs and enabled status
- **Skill usage**: Query recent session data for skill invocations:
  ```bash
  ${CLAUDE_PLUGIN_DIR}/skills/session/scripts/query.ts "SELECT content_text, count(*) as n FROM content_items WHERE tool_name = 'Skill' AND content_text IS NOT NULL GROUP BY content_text ORDER BY n DESC LIMIT 20"
  ```
- **Tool usage**: Query for frequently used tools:
  ```bash
  ${CLAUDE_PLUGIN_DIR}/skills/session/scripts/query.ts "SELECT tool_name, count(*) as n FROM content_items WHERE type = 'tool_use' GROUP BY tool_name ORDER BY n DESC LIMIT 20"
  ```
The session queries depend on the `claude-code:session` skill being installed in the same plugin. If the query script is not found, fall back to the plugin list only.

### Analyze and Present

Cross-reference changelog entries against the gathered context. An entry is relevant if it touches:

- A tool the user frequently uses (e.g., changes to `Edit`, `Bash`, `Agent`)
- A feature related to installed plugins (e.g., MCP, hooks, skills system)
- Workflows the user relies on (e.g., git operations, PR creation, session introspection)

Present findings as a table:

| Change | Version | Why It Matters |
|--------|---------|----------------|
| Brief description | `0.x.y` | How it relates to the user's setup |

Group by relevance: **directly relevant** first, then **potentially useful**. Skip entries with no clear connection to the user's workflow.

### Gotchas

- The changelog is large. Only read recent versions, not the full file.
- Session queries may return no data on a fresh install. Fall back to plugin/skill scanning only.
- The raw GitHub URL may occasionally 404 during deploys. Retry once before reporting the failure.
