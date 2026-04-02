---
name: doc-review:review
description: |
  Review a document through specialized lenses using parallel agents. Use when reviewing documentation, blog posts, READMEs, proposals, or any prose for quality issues across content, style, and embedded artifacts.
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

If no document path provided, ask the user. Optionally accept target audience and focus areas.

## Dispatch Agents

Read the document. Always spawn `doc-review:content` and `doc-review:style`. Spawn `doc-review:artifacts` only if the document contains URLs, markdown links, Mermaid code blocks, or markdown tables.

Spawn all applicable agents in parallel. Each receives the document content, audience, and focus areas.

For `doc-review:style`, also inject these writing preferences (sub-agents cannot see skills):

- Avoid AI-typical vocabulary: `meticulous`/`meticulously`, `pivotal`, `testament`, `underscore` (figurative), `interplay`, `intricacies`, `bolstered`, `garner`/`garnered`, `foster`/`fostering`
- Avoid promotional language: `boasts`, `vibrant`, `showcasing`, `nestled`, `groundbreaking`, `renowned`, `diverse array`
- Avoid copula avoidance ("X is Y" not fancy alternatives)
- Prefer shorter sentences over semicolons
- Direct, conversational tone

## Synthesize

Merge agent findings per [references/synthesis.md](references/synthesis.md). Deduplicate, rank by severity, and present a unified report.
