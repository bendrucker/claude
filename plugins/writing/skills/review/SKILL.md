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

- `--lens content|style|artifacts`: run only the named lenses. Comma-separate to select more than one (`--lens content,style`). Default: all applicable lenses per [Dispatch Agents](#dispatch-agents).

## Scan

Run the pattern rules over the document before any agent starts:

```bash
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=JSON <doc-path>
```

When the document is a PR, issue, or comment body, pipe it on stdin with `--ext=.prbody`. Vale exits 1 on an error-level alert, which is expected. Pass the JSON findings to `writing:style`.

## Dispatch Agents

Read the document. Always spawn `writing:content` and `writing:style`. Spawn `writing:artifacts` only if the document contains URLs, markdown links, Mermaid code blocks, or markdown tables.

When `--lens` is set, restrict the dispatch to the named lenses. `artifacts` still spawns only when the document actually contains links, diagrams, or tables.

Spawn all applicable agents in parallel. Each receives the document content, audience, and focus areas.

## Synthesize

Merge agent findings into one report. Deduplicate (keep the more detailed description), group by severity (Blocking > Important > Suggestions) rather than by agent, and order by document position within each severity. Each finding carries its section reference, issue, suggested fix, and which agent(s) flagged it.
