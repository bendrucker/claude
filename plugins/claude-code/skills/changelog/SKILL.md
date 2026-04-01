---
name: claude-code:changelog
description: Review the Claude Code CHANGELOG for recent additions relevant to the user's skills, plugins, and tool usage. Use when the user asks "what's new in Claude Code?", "any relevant changelog updates?", "what changed recently?", or wants to stay current with Claude Code features that affect their workflow.
allowed-tools:
  - Bash(gh release list --repo anthropics/claude-code:*)
  - Bash(gh release view --repo anthropics/claude-code:*)
  - Bash(claude plugin list:*)
---

# Claude Code Changelog Review

**Current version**: `!`claude --version``

Surface Claude Code changelog entries relevant to the user's installed plugins, skills, and tool usage patterns.

## Workflow

#### Fetch Releases

Use `gh release` against `anthropics/claude-code`:

- **List releases**: `gh release list --repo anthropics/claude-code --limit N`
- **View release body**: `gh release view --repo anthropics/claude-code <tag> --json body --jq '.body'`

Fetch the **two most recent releases** unless the user asks for a different range.

#### Gather Context

Run in parallel with the release fetch:

- **Installed plugins**: `claude plugin list --json`
- **Skill and tool usage**: Invoke the `claude-code:session` skill with queries for top skill invocations and top tools used. If the session skill is unavailable, skip and rely on the plugin list only.

#### Present

Cross-reference release notes against gathered context. Present as a table:

| Change | Version | Why It Matters |
|--------|---------|----------------|
| Brief description | `0.x.y` | How it relates to the user's setup |

Group by relevance: **directly relevant** first, then **potentially useful**. Skip entries with no connection to the user's workflow.
