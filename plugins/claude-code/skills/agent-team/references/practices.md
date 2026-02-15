# Agent Team Best Practices

## Give Teammates Enough Context

Teammates don't inherit the lead's conversation history. Include task-specific details in spawn prompts:

> Spawn a security reviewer with the prompt: "Review the authentication module at src/auth/ for vulnerabilities. Focus on token handling, session management, and input validation. The app uses JWT tokens in httpOnly cookies. Report issues with severity ratings."

## Size Tasks Appropriately

| Size | Problem |
|---|---|
| Too small | Coordination overhead exceeds the benefit |
| Too large | Teammates work too long without check-ins, risking wasted effort |
| Right | Self-contained units producing a clear deliverable (a function, test file, or review) |

Aim for 5-6 tasks per teammate.

## Avoid File Conflicts

Two teammates editing the same file leads to overwrites. Break work so each teammate owns a different set of files.

## Wait for Teammates

If the lead starts implementing instead of delegating:

> Wait for your teammates to complete their tasks before proceeding

Or enable delegate mode (Shift+Tab) to restrict the lead to coordination tools.

## Start with Research

If new to agent teams, start with read-only tasks: reviewing a PR, researching a library, investigating a bug. These show the value of parallel exploration without coordination challenges.

## Monitor and Steer

Check in on progress, redirect failing approaches, synthesize findings as they come in. Unattended teams risk wasted effort.

## Effective Team Structures

**Parallel review** — split review criteria into independent domains:

> Create a team to review PR #142. Three reviewers: security implications, performance impact, test coverage.

**Competing hypotheses** — make teammates adversarial:

> Spawn 5 teammates to investigate different hypotheses. Have them talk to each other to disprove theories, like a scientific debate.

**Cross-layer implementation** — one teammate per layer:

> Create a team: one for the API endpoint, one for the React component, one for integration tests.

## When to Use Teams

Teams add coordination overhead. Use them when parallelism savings exceed that cost.

**Good fits:**
- Independent features across different files/directories
- Multi-plugin or multi-package changes with clear boundaries
- Research tasks that can fan out (multiple codebases, docs, APIs)

**Poor fits:**
- Sequential tasks where each step depends on the previous
- Changes to a single file or tightly coupled file group
- Quick fixes, typos, or small enhancements

## Team Sizing

- **2-3 agents**: most common, manageable coordination
- **4-5 agents**: large independent workstreams
- **6+**: diminishing returns, coordination overhead dominates

Each agent consumes a full context window. Prefer fewer agents with well-scoped tasks over many agents with thin tasks.

## Task Decomposition

Decompose by **independence**, not by phase or layer.

**By feature/component** (preferred): each agent owns a complete vertical slice. Minimal cross-agent file conflicts.

**By file group**: each agent owns a set of files. Works when files are independent but the feature is shared.

**Avoid decomposing by phase**: "Agent A writes code, Agent B writes tests" creates dependencies and tight coupling between test and source code logic. "Agent A does research, Agent B implements" wastes the researcher's context.

## Sub-Agent Limitations

Teammates cannot spawn sub-agents. Code review, linting, and other verification tasks must be performed by the lead after teammates complete their work, or by assigning a dedicated reviewer teammate that receives work output via task descriptions.

## Testing Strategy

Assigning tests to the same agent that writes the feature creates tight coupling. Strategies:

- **Lead-defined specifications**: Lead writes test specifications or acceptance criteria upfront; teammates implement against them.
- **Dedicated test teammate**: A test teammate works from acceptance criteria, not source code.
- **Post-completion verification**: Lead runs tests and verification after feature agents complete.

This is an evolving area — no single approach dominates yet.

## Worktree Dispatch

When teammates need isolated worktrees, use `WORKTRUNK_WORKTREE_PATH` to place them under the project directory:

```bash
WORKTRUNK_WORKTREE_PATH='.worktrees/{{ branch | sanitize }}' wt switch --create feature/foo
```

This keeps worktrees within the sandbox's `.` write scope. Requires `Edit(.worktrees/**)` in `permissions.allow`.

Create all worktrees and spawn all agents from the project root before switching into any worktree. If the lead switches into a worktree first, agents spawned afterward inherit that worktree as their sandbox root — they won't be able to write to other worktrees.
