# Agent Team Best Practices

## Task Sizing

Tasks should be self-contained units producing a clear deliverable (function, test file, or review). Aim for 5-6 tasks per teammate. Break work so each teammate owns a different set of files, since two teammates editing the same file leads to overwrites.

## When to Use Teams

Teams add coordination overhead. Use them when parallelism savings exceed that cost: independent features across different files, multi-plugin or multi-package changes with clear boundaries, or research that fans out. Avoid them for sequential work, changes to a single file or tightly coupled group, or quick fixes.

Structures that work well: parallel review with the criteria split into independent domains, competing hypotheses where teammates debate to disprove each other, and cross-layer implementation with one teammate per layer.

## Team Sizing

- **2-3 agents**: most common, manageable coordination
- **4-5 agents**: large independent workstreams
- **6+**: diminishing returns, coordination overhead dominates

Each agent consumes a full context window. Prefer fewer agents with well-scoped tasks over many agents with thin tasks.

Each agent also runs a model, and teammates and Agent-tool subagents inherit the session model unless you set `model` explicitly. For mechanical, well-scoped work (fixes with clear specs, finders, verifiers, formatting passes), pass a cheaper model (`model: "sonnet"`, or `haiku` for trivial extraction) rather than billing fan-out at a premium session model's rate. Keep the premium tier for the orchestrator and judgment-heavy verification. The `model` value is a bare tier alias (`opus`, `sonnet`, `haiku`, `fable`), not a full model ID like `claude-sonnet-4-5`. Both the Agent tool and Workflow `agent()` accept these shorthands as-is. In Workflow scripts, pin `model` on `agent()` calls or per-phase in `meta.phases` for the same reason.

## Task Decomposition

Decompose by **independence**, not by phase or layer. Prefer complete vertical slices per agent (or independent file groups) with minimal cross-agent conflicts. Avoid "Agent A writes code, Agent B writes tests" (tight coupling) and "Agent A does research, Agent B implements" (wastes the researcher's context).

## Sub-Agent Limitations

Teammates cannot spawn sub-agents. Code review, linting, and other verification tasks must be performed by the lead after teammates complete their work, or by assigning a dedicated reviewer teammate that receives work output via task descriptions.

## Testing Strategy

Assigning tests to the same agent that writes the feature creates tight coupling. Alternatives: the lead writes test specifications or acceptance criteria upfront for teammates to implement against, a dedicated test teammate works from acceptance criteria rather than source code, or the lead runs verification after feature agents complete. No single approach dominates yet.

## Worktree Dispatch

When teammates need isolated worktrees, use `WORKTRUNK_WORKTREE_PATH` to place them under the project directory:

```bash
WORKTRUNK_WORKTREE_PATH='.worktrees/{{ branch | sanitize }}' wt switch --create feature/foo
```

This keeps worktrees within the sandbox's `.` write scope. Requires `Edit(.worktrees/**)` in `permissions.allow`.

Create all worktrees and spawn all agents from the project root before switching into any worktree. If the lead switches into a worktree first, agents spawned afterward inherit that worktree as their sandbox root and cannot write to other worktrees.
