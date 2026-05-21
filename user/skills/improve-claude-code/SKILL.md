---
name: improve-claude-code
description: |
  Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo.
  Use when the user wants to work on their Claude Code improvement backlog, process Things todos tagged claude-code, or batch-implement configuration changes.
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(pull-request:create)
  - Skill(code-review)
  - Skill(github:actions-monitor)
---

# Improve Claude Code

Work through the `claude-code` Things backlog: fetch todos, triage with the user, then plan and implement each in parallel as separate PRs.

All Things interaction goes through the `things:jxa` and `things:url` skills (never inline JXA). PRs go through `pull-request:create` (never `gh pr create`).

## Fetch and Triage

Use `things:jxa` to find all open todos tagged `claude-code`. Display a numbered table:

| # | Title | Notes (first line) | List |
|---|-------|--------------------|------|

Ask the user which items to work on (numbers, ranges like `1-3`, or `all`). Cap each batch at 3 to keep parallel agents manageable. Split larger selections automatically.

## Plan

Launch parallel `Plan` agents (one per todo). Give each the todo title, full notes, and instruction to explore the repo and produce a concrete implementation plan.

Point agents to relevant domain skills: `claude-code:skill` for skill changes, `claude-code:hook` for hooks, `bun:bun` for scripts.

Present all plans. For each, propose a `/code-review` effort (typically `low`; `medium` for changes touching multiple plugins) and confirm via `AskUserQuestion` alongside plan approval.

## Implement

For each approved plan, launch a background `general-purpose` agent with `isolation: "worktree"`. Each agent implements the plan, runs `bun test`, runs `/code-review <effort>` with the level chosen during planning, commits, and creates the PR via `pull-request:create`. Pass the same domain skills from the planning step.

#### PR body

Include an `Original Task` link so the PR traces back to the Things todo:

```
Original Task: [<todo-title>](https://things.bendrucker.me/show?id=<todo-id>)
```

## Monitor CI and Fix Failures

Use `github:actions-monitor` agents (one per PR) to collect pass/fail status. For failures, launch a worktree agent with the logs and branch to fix, test, and push. Re-monitor after fixes.

## Annotate Things

Use `things:url` to update each todo based on its PR outcome:

- **Passing**: Append PR link to notes, add `review` tag, remove `claude-code` tag, move to Anytime
- **Failing**: Append PR link and failure summary to notes. Leave `claude-code` tag so it resurfaces next run.

## Summary

Output a bulleted list (one entry per todo): PR link (pass/fail), Things URL (`https://things.bendrucker.me/show?id=<todo-id>`), title.
