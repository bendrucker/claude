---
name: diagram
description: Create and validate Mermaid diagrams. Use when creating, editing, or reviewing Mermaid diagrams in markdown files.
user-invocable: true
---

# Mermaid Diagrams

Create and validate Mermaid diagrams with syntax checking.

## Diagram Types

| Type | Directive | Use For |
|------|-----------|---------|
| Flowchart | `flowchart TB` | Process flows, decision trees, system architecture |
| Sequence | `sequenceDiagram` | API interactions, message passing, protocols |
| State | `stateDiagram-v2` | State machines, lifecycles, status transitions |
| ER | `erDiagram` | Database schemas, entity relationships |

## Validation

Validate mermaid syntax in markdown files:

```bash
bun ${CLAUDE_SKILL_ROOT}/scripts/validate.ts <file.md>
```

## References

- [Flowchart](./references/flowchart.md) — Nodes, edges, subgraphs, layout direction
- [Sequence](./references/sequence.md) — Participants, messages, activations, loops
- [State](./references/state.md) — States, transitions, composite states
- [ER](./references/er.md) — Entities, relationships, cardinality

## Best Practices

- Keep labels concise—use full descriptions in surrounding prose
- Use subgraphs to group related nodes visually
- Order participants/nodes to minimize edge crossings
- Prefer left-to-right (`LR`) for timelines, top-to-bottom (`TB`) for hierarchies
