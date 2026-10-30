---
name: mermaid
description: Create and validate Mermaid diagrams. Use when creating, editing, or reviewing Mermaid diagrams in markdown files.
user-invocable: true
---

# Mermaid Diagrams

Write Mermaid diagrams in markdown that parse cleanly. The work is done when the validator exits 0 on every file you touched:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/validate.ts <file.md>...
```

It prints each failing block's line and parser message. Add `--json` for structured output.

## Diagram Types

| Type | Directive | Use For | Reference |
|------|-----------|---------|-----------|
| Flowchart | `flowchart TB` | Process flows, decision trees, architecture | [flowchart.md](./references/flowchart.md) |
| Sequence | `sequenceDiagram` | API interactions, message passing, protocols | [sequence.md](./references/sequence.md) |
| State | `stateDiagram-v2` | State machines, lifecycles | [state.md](./references/state.md) |
| ER | `erDiagram` | Database schemas, entity relationships | [er.md](./references/er.md) |

Write node and message labels in a few words, with full descriptions in the surrounding prose.
