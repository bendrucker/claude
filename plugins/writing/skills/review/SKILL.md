---
name: writing:review
description: |
  Review a document through specialized lenses using parallel agents. Use when reviewing documentation, blog posts, READMEs, proposals, or any prose for quality issues across content, style, and embedded artifacts.
argument-hint: "<doc-path> [--lens content|style|artifacts]"
context: fork
agent: general-purpose
allowed-tools:
  - Read
  - Grep
  - Glob
  - Task
  - WebFetch
---

# Document Review

Review a document through parallel agents, each covering a different lens.

## Inputs

$ARGUMENTS

The first positional is the document path. If none is provided, ask the user. Optionally accept target audience and focus areas.

- `--lens content|style|artifacts`: run only the named lenses. Comma-separate to select more than one (`--lens content,style`). Default: all applicable lenses per [Dispatch Agents](#dispatch-agents).

## Dispatch Agents

Read the document. Always spawn `writing:content` and `writing:style`. Spawn `writing:artifacts` only if the document contains URLs, markdown links, Mermaid code blocks, or markdown tables.

When `--lens` is set, restrict the dispatch to the named lenses. `artifacts` still spawns only when the document actually contains links, diagrams, or tables, so a `--lens artifacts` run on a document with none spawns nothing.

Spawn all applicable agents in parallel. Each receives the document content, audience, and focus areas.

## Synthesize

Merge agent findings per [references/synthesis.md](references/synthesis.md). Deduplicate, rank by severity, and present a unified report.
