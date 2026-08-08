---
name: improve-claude-code
disable-model-invocation: true
description: |
  Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo, discover improvement candidates from session history, or watch open PRs to implement review feedback and close shipped todos.
  Use when the user wants to work on their Claude Code improvement backlog, process Things todos tagged claude-code, batch-implement configuration changes, mine session history for grounded config-change candidates (Discover mode), or watch this skill's open PRs for review feedback and merges (Watch mode).
argument-hint: "[discover [--scheduled] | watch | sweep]"
allowed-tools:
  - Read(${CLAUDE_SKILL_DIR}/references/*)
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(claude-code:session)
  - Skill(pull-request:create)
  - Skill(review:code)
  - Skill(github:actions-monitor)
  - Skill(github:pr-comments)
---

# Improve Claude Code

Work through the `claude-code` Things backlog: fetch todos, triage with the user, then plan and implement each in parallel as separate PRs.

The backlog has two sources. The user files todos tagged `claude-code` by hand (and `agent-ideas` files external-harvest ideas in the same shape). Discover mode mines session history for config-change candidates and files the keepers as `claude-code` todos. Both sources feed the one implement loop below.

In every mode, the loop itself is in scope: this skill's own SKILL.md, the `claude-code:session` skill's queries and views, and the Things scripts the loop depends on. Findings in that class may be dispatched to background worktree agents immediately, even when everything else routes to planning or triage discussion.

All Things interaction goes through the `things:jxa` and `things:url` skills (never inline JXA). PRs go through `pull-request:create` (never `gh pr create`).

## Arguments

`$0` (optional mode) routes to a workflow. With no mode, run the default backlog loop: [Fetch and Triage](#fetch-and-triage) the `claude-code` todos, then plan and implement the selection as PRs.

- `discover`: mine session history for grounded improvement candidates, write a digest, and file the keepers as todos. Interactive runs never auto-file. `--scheduled` is the unattended weekly variant. Read [references/discover.md](references/discover.md).
- `watch`: track the open PRs this skill opened, implement review feedback, and close each backing todo on merge. Run it under `/loop /improve-claude-code watch`. Read [references/watch.md](references/watch.md).
- `sweep`: propose stale or graduated memories for retirement and delete only what you approve. Interactive only, never unattended. Read [references/sweep.md](references/sweep.md).

## Fetch and Triage

Use `things:jxa` to find all open todos tagged `claude-code`. Display a numbered table:

| # | Title | Notes (first line) | List |
|---|-------|--------------------|------|

Ask the user which items to work on (numbers, ranges like `1-3`, or `all`). The workflows below cap their own concurrency at `min(16, cores-2)`, so never manually batch or split a large selection. Before firing a very large selection (roughly more than 15 items), confirm once, since each todo spawns its own worktree and PR.

## Session Context

Each todo's notes embed the originating session as `Session: <uuid>`. For every selected todo, use the `claude-code:session` skill to pull the original context (what you were doing, the commands that ran, the errors that prompted the todo) before planning: richer than the todo's prose summary and grounds each plan in the real failure. Session context informs local planning only: never paste session-derived content into PR bodies or any other output that leaves the machine. Index refresh, DuckDB lookup mechanics, host filtering, and the full egress rule: [references/session-context.md](references/session-context.md).

## Plan

The mechanical fan-out runs as a **Workflow**. Instructing `Workflow` from inside this user-invoked skill is a sanctioned opt-in under the Workflow tool's own rules, so author and run the script rather than refusing mid-run.

Run one Workflow (`parallel`) with one agent per selected todo. Give each agent its todo title, full notes, and the distilled session context, and have it explore the repo and produce an implementation plan. Point agents at the relevant domain skills: `claude-code:skill` for skill changes, `claude-code:hook` for hooks, `bun:bun` for scripts. Preserve the [egress rule](references/session-context.md) inside the workflow: session-derived context stays local and never enters agent output that leaves the machine.

Each agent returns a structured plan:

```
{ thingsId, todoTitle, plan, proposedEffort ('low'|'medium'|'high'), filesTouched[] }
```

The workflow returns the plans to the main loop. Present them there and collect approval plus a per-plan `review:code` effort (typically `low`; `medium` for changes touching multiple plugins) via `AskUserQuestion`. This gate is interactive, so it stays in the main loop and cannot move into a workflow.

## Implement

Feed the approved plans into a pipeline Workflow: `implement` (a worktree `general-purpose` agent implements the plan, runs `bun test` and `review:code <effort>` at the approved level, commits, and opens the PR via `pull-request:create` with an `Original Task` backlink) then `ciGate` (a fast initial CI check with one trivial-failure fix pass). Do not hold worktree agents open on long CI waits: the gate catches trivial breakage, then Watch handles the rest. Back in the main loop, [Annotate Things](#annotate-things) and [Summary](#summary) consume the pipeline results unchanged. Pipeline shape, stage schemas, and the PR body format: [references/implement.md](references/implement.md).

## Monitor CI and Fix Failures

The `ciGate` stage already ran a fast initial check with one trivial-failure fix pass, so each PR lands with a first CI signal. Hand ongoing CI and review tracking to Watch: `/loop /improve-claude-code watch` re-checks every open PR each tick, fixes CI failures, implements review feedback, and closes each backing todo on merge.

## Annotate Things

Use `things:url` to update each todo based on its PR outcome:

- **Passing**: Append PR link to notes, add `review` tag, remove `claude-code` tag, move to Anytime
- **Failing**: Append PR link and failure summary to notes. Leave `claude-code` tag so it resurfaces next run.

## Summary

Output a bulleted list (one entry per todo): PR link (pass/fail), Things URL (`https://things.bendrucker.me/show?id=<todo-id>`), title.
