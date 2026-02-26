---
name: issue
description: |
  Implement a feature or fix based on an issue. Use when given an issue URL to work on, or when implementing changes described in a tracked issue. Supports GitHub, Linear, and GitLab.
allowed-tools: Bash(gh:*), Bash(glab:*), Bash(git:*), mcp__github, mcp__plugin_github_github__issue_read, mcp__linear, mcp__plugin_github_github__search_code
---

Work on this issue: $ARGUMENTS

Register the target issue for auto-approve: `bun ${CLAUDE_PLUGIN_ROOT}/scripts/set-target.ts --session-id ${CLAUDE_SESSION_ID} "$ARGUMENTS"`

Fetch the issue, apply [safety guidelines](safety.md), then work autonomously — create a branch, commit, and open a PR following the `pull-request:create` skill.

After a `/compact`, review this file to restore context.
