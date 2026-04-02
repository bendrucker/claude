---
name: doc-review:review
description: |
  Review a document through specialized lenses using parallel agents. Use when reviewing documentation, blog posts, READMEs, proposals, or any prose for quality issues across style, accuracy, structure, code examples, links, diagrams, and tables.
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

Review a document through multiple specialized lenses, dispatching parallel agents for each applicable lens.

## Inputs

Ask the user to provide:

- **Document path**: File to review
- **Audience** (optional): Who the document is written for (developers, end users, stakeholders, etc.)
- **Focus areas** (optional): Specific concerns to prioritize

## Gather Context

Read the document. Identify which lenses apply using the trigger rules in [references/lenses.md](references/lenses.md).

The first three lenses always run:
- `doc-review:style-tone`
- `doc-review:technical-accuracy`
- `doc-review:coherence-structure`

Conditional lenses activate based on document content:
- `doc-review:example-code` (fenced code blocks present)
- `doc-review:citations-links` (URLs or markdown links present)
- `doc-review:diagrams` (mermaid code blocks present)
- `doc-review:tables` (markdown tables present)

## Dispatch Agents

Spawn all applicable agents in parallel using multiple Task tool calls in a single message. Each agent receives:

- The full document content
- The target audience (if provided)
- Any user-specified focus areas

For the `doc-review:style-tone` agent, also inject these writing preferences into the spawn prompt (sub-agents cannot see skills):

- Never use spaced em dashes (` --- `)
- Avoid AI-typical vocabulary: `meticulous`/`meticulously`, `pivotal`, `testament`, `underscore` (figurative), `interplay`, `intricacies`, `bolstered`, `garner`/`garnered`, `foster`/`fostering`
- Avoid promotional language: `boasts`, `vibrant`, `showcasing`, `nestled`, `groundbreaking`, `renowned`, `diverse array`
- Avoid copula avoidance ("X is Y" not fancy alternatives)
- Avoid "not just X, but also Y" constructions
- Limit semicolons (prefer shorter sentences)
- Write in a direct, conversational tone

## Synthesize

After all agents complete, merge their findings using [references/synthesis.md](references/synthesis.md):

- Deduplicate overlapping findings across lenses
- Rank by severity (Blocking > Important > Suggestions)
- Order by document position within each severity level
- Present a unified report to the user
