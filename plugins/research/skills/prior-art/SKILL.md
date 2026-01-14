---
name: prior-art
description: |
  Research existing solutions when exploring a new problem space. Use when the user mentions "prior art", "existing solutions", "what libraries exist for", or wants to understand the landscape before building.
---

Research prior art for: $ARGUMENTS

## Process

### Search

Identify relevant sources based on context:
- **GitHub**: Search for repositories matching the problem space
- **Package registries**: npm, PyPI, crates.io, pkg.go.dev—infer from current project or query
- **Web search**: For broader landscape understanding

Run searches in parallel. Infer the ecosystem from:
1. Current project's language/framework (if present)
2. Query terms (e.g., "React hook for X" implies npm)
3. Ask only if genuinely ambiguous

### Investigation

Start with 2-3 most promising projects:
1. Read README and high-level docs to assess relevance
2. Only examine code when relevance is confirmed AND implementation details matter
3. Dispatch parallel Task agents for each project, with explicit focus areas

If initial results don't satisfy the query, expand to additional projects.

**Agent dispatch example:**
```
Investigate [project] for prior art on [topic]:
- How does it approach [specific aspect]?
- What tradeoffs does it make?
- What can we learn for our use case?
```

### Synthesis

Gather findings and produce a recommendation:
- Identify common patterns across solutions
- Note meaningful variations in approach
- Infer user intent:
  - "build X" → learn patterns, inform implementation
  - "library for X" → find dependencies to use directly

## Output Format

Respond in the conversation with structured markdown (not files):

```markdown
## Prior Art: [Topic]

### Summary
[Common patterns, key variations, recommendation based on query intent]

### Projects

#### [Project Name]
- **Repository**: [link]
- **Relevance**: [why this matters to the query]
- **Approach**: [how it solves the problem]
- **Lessons**: [what to learn from it]

#### [Next Project]
...

### Additional Projects (not deeply investigated)
- [Project]: [one-line description]
- ...
```

## Behavior Guidelines

- **Honest reporting**: Acknowledge when prior art is sparse—don't force results
- **Research only**: Don't offer to integrate dependencies or modify the project
- **Ecosystem inference**: Derive from context, don't require explicit specification
- **Adaptive depth**: Investigate more projects if initial batch is insufficient
