---
name: writing:review
description: |
  Review a document through specialized lenses using parallel agents. Use when reviewing documentation, blog posts, READMEs, proposals, or any prose for quality issues across content, style, and embedded artifacts.
argument-hint: "<doc-path> [--lens content|style|artifacts]"
context: fork
agent: general-purpose
model: sonnet
allowed-tools:
  - Read
  - Grep
  - Glob
  - Task
  - WebFetch
  - Bash(bun:*)
---

# Document Review

Review a document through parallel agents, each covering a different lens.

## Inputs

$ARGUMENTS

The first positional is the document path. If none is provided, ask the user. Optionally accept target audience and focus areas.

- `--lens content|style|artifacts`: run only the named lenses. Comma-separate to select more than one (`--lens content,style`).

## Scan

Run the pattern rules over the document before any agent starts:

```bash
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=JSON <doc-path>
```

When the document is a PR, issue, or comment body, pipe it on stdin with `--ext=.prbody`. Vale exits 1 on an error-level alert, which is expected. Pass the JSON findings to `writing:style`.

## Dispatch Agents

Spawn `writing:content` and `writing:style` in parallel, plus `writing:artifacts` when the document contains URLs, markdown links, Mermaid code blocks, or markdown tables. `--lens` restricts the set to the named lenses under the same artifacts condition. Each agent receives the document content, audience, and focus areas.

## Synthesize

Merge agent findings into one report, grouped by severity (Blocking > Important > Suggestions) and ordered by document position within each severity. Merge duplicates into the more detailed description. Each finding carries its section reference, issue, suggested fix, and the agent(s) that flagged it. The report is done when every agent finding appears in it or in a merged duplicate.
