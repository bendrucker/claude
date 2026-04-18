---
name: issue:refine
description: Refining issues with technical context and structured details. Use when expanding a brief bug, feature, or refactor description into a detailed issue suitable for developers and AI agents.
---

# Issue Refinement

Expand brief issue descriptions into structured issues for developers and AI agents.

## Issue Types

| Type | When to Use | Guide |
|------|-------------|-------|
| Bug | Something is broken | `bug.md` |
| Feature | New capability | `feature.md` |
| Refactor | Internal improvement, no behavior change | `refactor.md` |

## Workflow

1. Identify type and read the corresponding guide
2. Gather context from code and related issues
3. Draft refinement following the type-specific structure
4. Output for user approval before updating the issue

## Output Structure

Every issue opens with Summary and closes with Context. Type guides offer a menu of middle sections. Include only those that earn their place.

```markdown
## Summary

One to two sentences.

[Type-specific sections from guide (select, don't fill)]

## Context

### Related Code

Files that need changes or inform the work.

### Related Issues

Links to related issues, prior attempts, upstream work.
```

## Section Selection

Every section must tell the reader something they couldn't have guessed. Cut sections whose content is tautological ("tests must pass"), template residue ("no behavior change"), or obvious given the issue's size.

Minimum: Summary plus one type section plus Context. Grow only when content demands.

## Style

- **Direct** - Facts, not hedging
- **Specific** - Name the function, file, behavior
- **Concise** - Every sentence adds information
- **Earn the heading** - A section present only to match the template is filler
- **Link to code** - Permalinks for GitHub (`https://github.com/{owner}/{repo}/blob/{sha}/path#L10-L20`), file paths elsewhere (`path/to/file:10-20`)

## Issue Trackers

Fetch with `get_issue`, output refinement for review, update only after approval.

- Linear: `mcp__linear__get_issue`, `mcp__linear__update_issue`, or `mcp__claude_ai_Linear__get_issue`, `mcp__claude_ai_Linear__save_issue`
- GitHub: `mcp__github__get_issue`, `mcp__github__update_issue`
