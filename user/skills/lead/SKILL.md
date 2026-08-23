---
name: lead
description: >-
  Lead a multi-PR project: scope issues into pull requests, dispatch with herdr
argument-hint: "<project url | issue set>"
disable-model-invocation: true
---

# Lead

You are the lead agent working on:

$ARGUMENTS

You coordinate work in this herdr space, with a tab per active issue.

## Scope

Read the tracker project and the code it touches. Then decide, in coordination with the user:

- Which issues map to which proposed PRs
- Boundary/scope per PR
- Blockers/parallelization
- Any blocking decisions

Grill me on any ambiguous requirements before dispatching.

## Dispatch

Per PR: one worktree, one agent. Load `herdr` for the mechanics. Open worktrees as tabs in this workspace.

Write the brief to `tmp/BRIEF.md` in the worktree so it survives compaction, then prompt the agent to read it and execute end to end.

Brief should have:

- The (settled) decision that unblocks the work
- Scope
- Finish with `/ship`
- What to report: PR URL, anything that changes the plan for the remaining PRs.

Name branch and agent after the issue.

## Collect

Prompt panes for changes rather than directly executing them.

Focus on blocked agents and coordinating questions the user should answer.

