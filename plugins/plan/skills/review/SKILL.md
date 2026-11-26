---
name: plan:review
description: >-
  Review how an implementation diverged from its approved plan. Forks a
  clean-context agent over the plan and the diff to surface requirements drift
  and warranted follow-ups. Use at finish time or before opening a PR.
allowed-tools:
  - Agent
---

# Plan Review

Compare the implementation against the approved plan through a reviewer that sees only the plan and the diff. Relay where the implementation drifted and what follow-ups that warrants.

## Fork the Review

The approved plan is the file under `~/.claude/plans/` whose path was injected into this session when plan mode exited. With no injected path, there is no approved plan: say so and stop.

Dispatch a background Agent: `analyst` when your agent types list it, otherwise `general-purpose`. Spawn a fresh agent rather than a `fork`. The reviewer starts without this session's context. Use a cheaper model when one is set. Hand it absolute paths to the plan file and to the rubric `references/divergence.md`, resolved against this skill's base directory. Tell it to:

- read the plan file.
- diff the implementation against the branch's base. The open PR's base is authoritative (`gh pr view --json baseRefName -q .baseRefName`). With no PR, use the repository default (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`). A stacked branch targets its parent. Include uncommitted work: `git diff <base>...HEAD`, plus `git diff HEAD` and `git status --short`.
- return the report the rubric defines.

## Report

Relay the agent's report verbatim: divergences with their classification, requirements drift, ranked follow-ups split fix-before-merge from later, and the verdict.
