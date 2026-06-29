---
name: issue:refine
description: Refining issues with technical context and structured details. Use when expanding a brief bug, feature, or refactor description into a detailed issue suitable for developers and AI agents.
argument-hint: "[--type bug|feature|refactor] [--compact]"
---

# Issue Refinement

Expand brief issue descriptions into structured issues for developers and AI agents.

## Arguments

Parse `$ARGUMENTS`:

- `--type bug|feature|refactor`: skip type identification and read that guide directly. Default: infer the type from the description per [Issue Types](#issue-types).
- `--compact`: force the tight output, a sentence or two that names the problem and points at the code, with no Summary/Context frame. Default: size the output to the issue per [Section Selection](#section-selection).

## Issue Types

| Type | When to Use | Guide |
|------|-------------|-------|
| Bug | Something is broken | `bug.md` |
| Feature | New capability | `feature.md` |
| Refactor | Internal improvement, no behavior change | `refactor.md` |

## Workflow

1. Identify type and read the corresponding guide. When `--type` is set, use it and skip identification.
2. Gather context from code and related issues
3. Draft refinement following the type-specific structure. Under `--compact`, produce the tight output described in [Section Selection](#section-selection).
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

`--compact` forces that trivial output regardless of size: name the problem, point at the code, drop the Summary/Context frame.

## Style

State facts, not hedging. Name the function, file, or behavior rather than describing it vaguely. Every sentence should add information. A section present only to match the template is filler, so earn each heading.

Link to code. Use permalinks for GitHub (`https://github.com/{owner}/{repo}/blob/{sha}/path#L10-L20`) and file paths elsewhere (`path/to/file:10-20`).

Don't use spaced em dashes. Split into two sentences without a semicolon or unspaced substitute.

## Issue Trackers

Fetch the issue, output the refinement for approval, and update the tracker only after approval. Defer tracker-save mechanics to the platform skill. For Linear, use `linear:linear`.
