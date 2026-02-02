---
name: pr-comments
description: Fetch unresolved review comments from a GitHub pull request. Use when checking what review feedback needs to be addressed, whether review comments have been resolved, or resuming work on a PR with outstanding feedback.
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)"]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
---

# PR Review Comments

Fetch unresolved review threads from a GitHub pull request, filtered for context efficiency. Avoids flooding the context with resolved threads. Outdated threads are included but marked.

## Usage

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts <pr-url> [--role author|reviewer] [--since last-review|<date>]
```

## Arguments

- `<pr-url>` — GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- `--role` — `author` or `reviewer` (default: auto-detect based on authenticated user)
- `--since` — Filter to threads with activity since: `last-review` or ISO date

## Role

- **author** (default when authenticated user is the PR author): Shows all unresolved threads — feedback that needs to be addressed.
- **reviewer** (default when authenticated user is not the PR author): Shows only unresolved threads started by the authenticated user — checks whether comments have been resolved.

## Since

- `last-review`: Scopes to threads with activity since the last relevant review.
  - As author: since the most recent review by a human other than you (bot reviews are excluded)
  - As reviewer: since your most recent submitted review
- ISO date: Explicit cutoff (e.g., `2025-01-15`)

## Examples

```bash
# What's unresolved? (auto-detect perspective)
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts https://github.com/owner/repo/pull/123

# As author: what new feedback since the last review?
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts https://github.com/owner/repo/pull/123 --role author --since last-review

# As reviewer: are my comments resolved?
bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-comments.ts https://github.com/owner/repo/pull/123 --role reviewer
```

## Output

Compact markdown grouped by file with line numbers and full comment bodies — enough to act on the feedback directly without additional API calls.
