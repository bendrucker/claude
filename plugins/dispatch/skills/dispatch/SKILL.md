---
name: dispatch
description: >-
  Hand new work bound for its own pull request to a fresh Claude session in a new worktree, opened in a Rex tab or a herdr workspace with its permissions written ahead of time. Use when a task should run beside this session rather than inside it, including a change this session found that belongs in another branch or repository. Not for re-rooting this session (`worktrunk:wt-switch-create`) or in-session subagents (`Agent`).
argument-hint: "--branch <branch> --prompt <file>"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts:*)
---

# Dispatch

Start a separate Claude session on a new branch that takes a task through to its own PR while this session keeps working. The script creates the worktree with `wt`, writes the session's `.claude/settings.local.json`, and launches `claude --name <name> <prompt>` in the multiplexer hosting this session.

## Write the Prompt

Write the prompt to a file under `tmp/`. The dispatched session starts with no context from this one, so state the goal, the files to read, what is already ruled out, and the completion criterion. Keep it under 128KB. For larger material, point the session at a file.

## Grant Permissions

Pass the permissions the task needs so the session runs without prompting for them:

- `--allow <rule>`: a `permissions.allow` rule, such as `"Bash(bun test:*)"`. Repeatable.
- `--sandbox-write <path>`: a `sandbox.filesystem.allowWrite` path outside the worktree, such as `~/.cache/<tool>`. Repeatable.
- `--settings-json <file>`: any other settings, deep-merged.

The script merges these into the worktree's `.claude/settings.local.json`, keeping existing keys and skipping array entries already present. It refuses to write when that file is not git-ignored.

## Pick the Multiplexer

Dispatch into the multiplexer hosting this session, which `--mux` defaults to. Outside one, or when the script reports Rex and herdr nested, ask the user with `AskUserQuestion` and pass the answer as `--mux`. List the options in this order:

1. `rex`: a Rex tab.
2. `herdr`: a herdr workspace.
3. `bg`: a `claude --bg` session with no terminal. Recommend it only for short, self-contained work, because a session with no tab is easy to lose track of. The ledger, `dispatches.jsonl` in the plugin data dir, records it so you can find it again.

## Run It

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts --repo "$REPO" --branch "$BRANCH" --prompt "$PROMPT_FILE" [--allow <rule>]... [--sandbox-write <path>]...
```

- `--base` defaults to `origin/main`, fetched first.
- `--name` defaults to a slug of the branch.
- Under Rex the session opens in a new tab labeled with the branch. `--split` opens it in a pane to the right of this one instead. From outside Rex, pass `--session <id or label>` from `rex ls`.
- `--timeout` (ms, default 30000) bounds the wait for the session to start.

Run `--help` for the rest.

## Read the Result

On success the script prints one JSON line:

- `name`: the session name to address it by.
- `path`, `branch`: the worktree.
- `mux`, `target`: the Rex block, herdr pane, or `claude --bg` id running the session.
- `settings`: the settings keys written.
- `status`:
  - `working`: the session took the prompt.
  - `blocked`: a dialog is showing, such as folder trust or a permission prompt. Read the screen (`rex capture -b <target> --trim`, `herdr agent read <name>`, or `claude logs <target>`) and tell the user what it asks. The user answers it.
  - `unknown`: the session showed neither before the timeout. Read the screen before reporting the hand-off.
- `submoduleError`, when present: submodules failed to initialize. The session can repair them.

A failure exits 1 and prints the error. Once the worktree exists, it also prints the partial record, so report `path` to the user as an orphaned checkout to clean up.

## Follow Up

1. Confirm `name` appears in `ListAgents`.
2. Talk to the session with `SendMessage` to `name`. Its replies arrive in this conversation.

The hand-off is done when `ListAgents` lists the session and the user has its `name`, `branch`, and `status`.
