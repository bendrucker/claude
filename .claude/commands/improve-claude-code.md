---
description: "Triage and batch-implement Claude-tagged Things todos as PRs"
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(things:inbox)
  - Skill(pull-request:create)
  - Skill(github:actions-monitor)
---

# Improve Claude Code

Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo.

## Rules

- Do NOT write inline JXA or AppleScript — always load and use the `things:jxa` and `things:url` skills
- Do NOT call `gh pr create` directly — always use the `pull-request:create` skill
- The Things tag name is lowercase `claude` (not `Claude`)

## Workflow

### Fetch Todos

Load the `things:jxa` skill. Find all open todos tagged `claude`. Track which list each item came from.

### Present for Triage

Display a numbered table with columns: #, Title, Notes (first line), List (inbox/anytime/someday).

Ask the user which items to work on. Accept numbers, ranges (e.g. `1-3`), or `all`. Enforce a max batch size of 3 — split larger selections automatically.

### Plan Each Todo

Launch parallel `Plan` agents via the Task tool (one per selected todo). Each agent receives:

- Todo title and full notes
- Instruction to explore the repo, identify files to modify, and produce a concrete implementation plan

Collect all plans and present them to the user in a numbered list. User approves or rejects each. Only approved plans proceed.

### Implement and Create PRs

For each approved plan, launch a `general-purpose` agent via the Agent tool with `isolation: "worktree"`. Each agent receives:

- The full approved implementation plan
- Instruction to implement changes, commit with a descriptive message, and create the PR using the `pull-request:create` skill
- Relevant skill guidance (e.g., skill structure conventions from `claude-code:skill` when creating skills)

PR body includes an `Original Task` section:

```
Original Task: [<todo-title>](https://things.bendrucker.me/show?id=<todo-id>)
```

### Monitor CI

Load the `github:actions-monitor` skill for each PR. Wait for all to complete. Collect pass/fail status and failure logs.

### Fix Failures

For failing PRs, dispatch `general-purpose` agents to the worktree branch to fix the issue. The agent receives the failure logs and instructions to fix, commit, and push.

### Annotate and Complete

Load the `things:url` skill. For each passing PR, update the Things todo notes with the PR link and mark the todo complete.

### Present Summary

Output a final bulleted list — one entry per todo:

- PR link (with pass/fail status)
- Things URL: `https://things.bendrucker.me/show?id=<todo-id>`
- Todo title
