---
description: "Triage and batch-implement Claude-tagged Things todos as PRs"
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(pull-request:create)
  - Skill(github:actions-monitor)
---

# Improve Claude Code

Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo.

## Rules

- Do NOT write inline JXA or AppleScript — always load and use the `things:jxa` and `things:url` skills
- Do NOT call `gh pr create` directly — always use the `pull-request:create` skill
- The Things tag name is `claude-code`

## Workflow

### Fetch Todos

Load the `things:jxa` skill. Find all open todos tagged `claude-code`. Track each item's ID, title, notes, and originating list.

### Present for Triage

Display a numbered table with columns: #, Title, Notes (first line), List (inbox/anytime/someday).

Ask the user which items to work on. Accept numbers, ranges (e.g. `1-3`), or `all`. Enforce a max batch size of 3 — split larger selections automatically.

### Plan Each Todo

Launch parallel `Plan` agents via the Task tool (one per selected todo). Each agent receives:

- Todo title and full notes
- Instruction to explore the repo, identify files to modify, and produce a concrete implementation plan
- Which skills to load for domain context (e.g., `claude-code:skill` for skill changes, `claude-code:hook` for hooks, `bun:bun` for scripts)

Collect all plans and present them to the user in a numbered list. User approves or rejects each. Only approved plans proceed.

### Implement and Create PRs

For each approved plan, launch a `general-purpose` agent via the Agent tool with `isolation: "worktree"`. Each agent receives:

- The full approved implementation plan
- The todo ID and title for the `Original Task` link
- Instruction to implement changes, run `bun test` to verify, commit with a descriptive message, and create the PR using the `pull-request:create` skill
- Which skills to load for the domain (same as the planning step)

PR body includes an `Original Task` section:

```
Original Task: [<todo-title>](https://things.bendrucker.me/show?id=<todo-id>)
```

### Monitor CI

Launch parallel Task agents (one per PR) using the `github:actions-monitor` skill. Collect pass/fail status and failure logs from each.

### Fix Failures

For each failing PR, launch a `general-purpose` agent via the Agent tool with `isolation: "worktree"`. The agent receives:

- The failure logs from CI
- The branch name to check out
- Instruction to fix the issue, run `bun test`, commit, and push

After all fix agents complete, re-monitor CI for the affected PRs.

### Annotate and Complete

Load the `things:url` skill.

- **Passing PRs**: Append the PR link to the todo's notes, add the `review` tag, remove the `claude-code` tag, and move the todo to Anytime.
- **Still-failing PRs**: Append the PR link and failure summary to the todo's notes. Leave the `claude-code` tag so the item surfaces in the next run.

### Present Summary

Output a final bulleted list — one entry per todo:

- PR link (with pass/fail status)
- Things URL: `https://things.bendrucker.me/show?id=<todo-id>`
- Todo title
