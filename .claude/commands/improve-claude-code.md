---
description: "Triage and batch-implement Claude-tagged Things todos as PRs"
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(things:inbox)
  - Skill(pull-request:create)
---

# Improve Claude Code

Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo.

## Workflow

### Fetch Todos

Query Things inbox (`TMInboxListSource`), anytime (`TMNextListSource`), and someday (`TMSomedayListSource`) lists. Filter for items tagged `Claude` with `open` status. Track which list each item came from.

### Present for Triage

Display a numbered table with columns: #, Title, Notes (first line), List (inbox/anytime/someday).

Ask the user which items to work on. Accept numbers, ranges (e.g. `1-3`), or `all`. Enforce a max batch size of 5 — split larger selections automatically.

### Plan Each Todo

Launch parallel `Plan` agents (one per selected todo). Each agent receives:

- Todo title and full notes
- Instruction to explore the repo, identify files to modify, and produce a concrete implementation plan

Collect all plans and present them to the user in a numbered list. User approves or rejects each. Only approved plans proceed.

### Create Worktrees

For each approved plan, create a worktree:

```bash
wt switch --create improve/{slug}
```

Derive `{slug}` from the todo title: lowercase, replace spaces/special chars with hyphens, truncate to 50 chars.

### Implement in Parallel

Dispatch `general-purpose` Task agents, one per worktree. Each agent receives the approved implementation plan and the worktree path. Agent implements changes, commits, pushes, and creates a PR.

PR body includes a `☑️ Original Task` section:

```
☑️ Original Task: [<todo-title>](things:///show?id=<todo-id>)
```

### Local Review

Launch `pr-review-toolkit:code-reviewer` agents for each PR. If issues are found, present them to the user for decision before proceeding.

### Monitor CI

Launch `github:actions-monitor` agents for each PR. Wait for all to complete. Collect pass/fail status and failure logs.

### Annotate and Complete

For each passing PR, update the Things todo notes with the PR link and mark the todo complete.

### Present Summary

Output a final bulleted list — one entry per todo:

- PR link (with pass/fail status)
- Things URL: `things:///show?id=<todo-id>`
- Todo title

## Agents

| Agent | Type | Purpose |
|-------|------|---------|
| Planning | `Plan` | Explore repo, create implementation plan for a single todo |
| Implementation | `general-purpose` | Implement changes in worktree, commit, push, create PR |
| Code Review | `pr-review-toolkit:code-reviewer` | Local review of PR changes |
| CI Monitor | `github:actions-monitor` | Watch GitHub Actions, report pass/fail with logs |

Planning and implementation agents run in parallel. Code review and CI monitoring run after PR creation, in parallel across all PRs.
