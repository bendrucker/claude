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

Task tool subagents cannot write to worktree directories (permissions are scoped to the orchestrator's cwd). Use `claude -p` CLI processes instead — each gets the worktree as its cwd with full local file access.

For each worktree, write the implementation plan to a temp file, then dispatch:

```bash
cd <worktree-path> && claude -p \
  --allowedTools "Read Write Edit Glob Grep Bash(git:*) Bash(bun:*) Bash(bunx:*)" \
  --output-format text \
  "<implementation-plan>" 2>&1
```

Run all dispatches as background Bash commands for parallelism. The prompt should include:

- The full approved implementation plan
- Instruction to commit changes with a descriptive message
- Relevant skill guidance (e.g., skill structure conventions from `claude-code:skill` when creating skills)

### Create PRs

After all implementations complete, dispatch `claude -p` from each worktree to create PRs:

```bash
cd <worktree-path> && claude -p \
  --allowedTools "Bash Read Write Edit Glob Grep Skill" \
  --output-format text \
  "Use the pull-request:create skill to create a PR. <context about the changes>" 2>&1
```

PR body includes a `Original Task` section:

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

## Dispatching CLI Agents

When using `claude -p` for worktree work:

- **Least privilege**: Use `--allowedTools` to scope to exactly the tools needed. Never use `--dangerously-skip-permissions`.
- **No model override**: Let the user's default model apply. Do not pass `--model`.
- **Background execution**: Run via `Bash(run_in_background: true)` and poll with `TaskOutput` for parallelism.
- **Error handling**: Check exit codes and read output files. If an agent fails, report the error rather than retrying blindly.
