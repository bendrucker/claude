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

Load the `things:jxa` skill. Find all open todos tagged `claude`. Track which list each item came from.

### Present for Triage

Display a numbered table with columns: #, Title, Notes (first line), List (inbox/anytime/someday).

Ask the user which items to work on. Accept numbers, ranges (e.g. `1-3`), or `all`. Enforce a max batch size of 5 — split larger selections automatically.

### Plan Each Todo

Launch parallel `Plan` agents via the Task tool (one per selected todo). Each agent receives:

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

Dispatch a `claude -p` CLI subprocess to each worktree (see "Worktree Dispatch" in user CLAUDE.md). Each subprocess receives:

- The full approved implementation plan
- Instruction to commit changes with a descriptive message
- Relevant skill guidance (e.g., skill structure conventions from `claude-code:skill` when creating skills)

### Create PRs

After all implementations complete, dispatch `claude -p` from each worktree to create PRs using the `pull-request:create` skill.

PR body includes an `Original Task` section:

```
Original Task: [<todo-title>](things:///show?id=<todo-id>)
```

### Monitor CI

Launch `github:actions-monitor` agents (via Task tool) for each PR. Wait for all to complete. Collect pass/fail status and failure logs. Fix failures in each worktree using `claude -p` the same way as implementation.

### Annotate and Complete

For each passing PR, update the Things todo notes with the PR link and mark the todo complete.

### Present Summary

Output a final bulleted list — one entry per todo:

- PR link (with pass/fail status)
- Things URL: `things:///show?id=<todo-id>`
- Todo title

