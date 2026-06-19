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

For `writing:style`, also inject these writing preferences (sub-agents cannot see skills):

- Avoid AI-typical vocabulary: `meticulous`/`meticulously`, `pivotal`, `testament`, `underscore` (figurative), `interplay`, `intricacies`, `bolstered`, `garner`/`garnered`, `foster`/`fostering`
  - These words are **review-only**. They do not appear in the hook wordlists because none has a corpus audit behind it. The review skill runs in batch mode where a human triages flags (recall matters more than precision), matching the analyze-and-review bar from linguistics.md. Promoting any to the hook wordlists requires a corpus audit confirming lift and distinctiveness versus the user's voice baseline.
- Avoid promotional language: `boasts`, `vibrant`, `showcasing`, `nestled`, `groundbreaking`, `renowned`, `diverse array`
- Avoid copula avoidance ("X is Y" not fancy alternatives)
- Split connector-joined clauses (semicolons, dashes) into separate sentences
- Direct, conversational tone
- Headings are short noun-phrase topic labels, not sentences. Flag a heading that contains a finite verb, reads as a `Topic: explanatory clause`, or is otherwise a full clause. Cut to the noun phrase; push the explanation into the first sentence.

## Synthesize

Merge agent findings per [references/synthesis.md](references/synthesis.md). Deduplicate, rank by severity, and present a unified report.
