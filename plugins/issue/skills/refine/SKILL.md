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

Lead with what's wrong or what's needed. For a substantial issue, open with Summary and close with Context, drawing middle sections from the type guide's menu. Include only those that earn their place. A trivial issue can be a tight paragraph or a single sentence. Don't wrap it in a Summary and Context skeleton it doesn't need.

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

For a substantial issue, Summary plus one type section plus Context is the floor. Grow only when content demands. A trivial issue needs none of that frame: a sentence or two that names the problem and points at the code is enough.

## Style

State facts, not hedging. Name the function, file, or behavior rather than describing it vaguely. Every sentence should add information. A section present only to match the template is filler, so earn each heading.

Link to code. Use permalinks for GitHub (`https://github.com/{owner}/{repo}/blob/{sha}/path#L10-L20`) and file paths elsewhere (`path/to/file:10-20`).

## Issue Trackers

Fetch with `get_issue`, output refinement for review, update only after approval.

- Linear: `mcp__linear__get_issue`, `mcp__linear__update_issue`, or `mcp__claude_ai_Linear__get_issue`, `mcp__claude_ai_Linear__save_issue`
- GitHub: `mcp__github__get_issue`, `mcp__github__update_issue`
