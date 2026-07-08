---
name: issue:refine
description: Refining issues with technical context and structured details. Use when expanding a brief bug, feature, or refactor description into a detailed issue suitable for developers and AI agents.
argument-hint: "[--type bug|feature|refactor|spike] [--compact]"
---

# Issue Refinement

Expand brief issue descriptions into structured issues for developers and AI agents.

## Arguments

Parse `$ARGUMENTS`:

- `--type bug|feature|refactor|spike`: skip type identification and read that guide directly. Default: infer the type from the description per [Issue Types](#issue-types).
- `--compact`: force the tight body, a sentence or two that names the problem and points at the code, with no `## Context` frame. Frontmatter is always emitted. Default: size the body to the issue per [Section Selection](#section-selection).

## Issue Types

| Type | When to Use | Guide |
|------|-------------|-------|
| Bug | Something is broken | `bug.md` |
| Feature | New capability | `feature.md` |
| Refactor | Internal improvement, no behavior change | `refactor.md` |
| Spike | Timeboxed investigation; output is a recommendation, not a shipped change | `spike.md` |

## Workflow

1. Identify type and read the corresponding guide. When `--type` is set, use it and skip identification.
2. Gather context from code and related issues. Consolidate keyword variants into one or two broader searches per topic rather than a separate call per phrasing. Scan results by title and summary with a small result limit, and fetch full issue bodies only for the issues that will inform the refinement.
3. Draft refinement following the type-specific structure. Under `--compact`, produce the tight output described in [Section Selection](#section-selection).
4. Write `tmp/issue-<slug>.md`, output it for approval, then hand the file to the platform skill.

## Output Structure

Refine writes the issue to `tmp/issue-<slug>.md`: YAML frontmatter for the
metadata a tracker stores as fields, then the body below the closing `---`. The
body leads with the summary prose directly, under no heading.

```markdown
---
title: fix connection pool exhaustion under load   # sentence case, one line
type: bug                                           # bug | feature | refactor | spike
labels: [performance, database]                     # optional; neutral tags
priority: high                                      # optional; urgent | high | medium | low
relations:                                          # optional; tracker links per relation
  blocks: []
  blocked-by: []
  related:
    - https://linear.app/acme/issue/ENG-1970
  duplicate-of: []
---

The nightly export marks its run successful even when per-object retrievals
time out, so downstream jobs read a partial snapshot as if it were complete.

[Type-specific sections from guide (select, don't fill)]

## Context

### Related Code

Files that need changes or inform the work.
```

Populate only the keys you can infer: `title`, `type`, `labels`, `priority`,
`relations`. Omit any optional key you can't fill, and drop empty relation
lists. The platform skill fills routing and workspace fields (team, assignee,
state, estimate) at save time.

Write the `title` in sentence case: capitalize the first word and proper nouns,
and leave the rest lowercase. This sets it apart from the title-case body
headings. Keep it to one line with no long parentheticals.

A related issue you found belongs under `relations` as a tracker link, kept out
of the body. Mention another issue in the body only when it tells the reader
something the relation can't: what a prior attempt tried, why upstream work
matters. Never append a standalone Related Issues section. It just restates
links the relation already expresses.

## Section Selection

Every section must tell the reader something they couldn't have guessed. Cut sections whose content is tautological ("tests must pass"), template residue ("no behavior change"), or obvious given the issue's size.

For a substantial issue, the opening summary plus one type section plus `## Context` is the floor. Grow only when content demands. A trivial issue needs none of that frame: a sentence or two that names the problem and points at the code is enough.

`--compact` forces that trivial body regardless of size: name the problem, point at the code, drop the `## Context` frame. Frontmatter is still emitted.

## Style

State facts and drop the hedging. Name the function, file, or behavior rather than describing it vaguely. Every sentence should add information. A section present only to match the template is filler, so earn each heading.

Section headings are title-case noun phrases. Keep them free of sentences, slogans, and "X, not Y" antithesis. Write "Connection Lifecycle" rather than "Pin, don't invalidate".

Plain words over jargon and marketing. Drop terms like "spike" (as a verb), "seam", "disposition", "reality". Say what the thing does.

Reference code by symbol. Name the function or type and quote the few relevant lines inline. Skip bare line ranges (`file.py:26-56`, `#L26-L56`): they go stale as the file changes. Use a SHA-pinned permalink only when a stable anchor is genuinely needed.

Reference issues and PRs as tracker links that expand inline, never as bare numbers (`ENG-1970`, `!578`, `#123`) a reader can't resolve. The platform skill owns the link syntax.

Don't use spaced em dashes. Split into two sentences without a semicolon or unspaced substitute.

## Issue Trackers

Fetch the issue, write `tmp/issue-<slug>.md`, and output it for approval. After approval, hand the file to the platform skill, which maps the frontmatter to tracker fields and saves the body from the file. Defer all save mechanics to that skill. For Linear, use `linear:linear`.
