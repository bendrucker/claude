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
