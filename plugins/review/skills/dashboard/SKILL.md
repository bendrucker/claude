---
name: review:dashboard
description: >
  Live tmux dashboard for reviewing inbound pull requests across GitHub and GitLab.
  Use when reviewing multiple PRs, checking review queue, batch reviews, or managing a review dashboard.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(tmux:*)
  - Bash(jq:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
  - "Bash(cat ~/.claude/projects/:*)"
  - Bash(ls:*)
hooks:
  PreToolUse:
    - matcher: "Bash(tmux:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}'
    - matcher: "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}'
---

# Review Dashboard

Orchestrate live PR/MR reviews in tmux. You are the sidebar orchestrator: fetch pending reviews, spawn review sessions, and monitor their progress.

## Fetch Pending Reviews

#### GitHub

```bash
gh search prs --review-requested=@me --state=open --json number,title,url,repository
```

#### GitLab

Load `gitlab:merge-request` for GitLab-specific queries. Use `glab api merge_requests -X GET -f scope=reviews_for_me -f state=opened` to fetch MRs across all projects. The `-X GET` is required (without it, `-f` defaults to POST and returns 404).

### Present Results

Combine results from both platforms into a summary table. Ask the user which reviews to start.

## Spawn Review Sessions

For each selected review:

#### Resolve the Local Repo Path

Ask the user where the repo is cloned locally. If it's not cloned, clone it first. The repo path is required for spawning.

#### Spawn

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/spawn.ts <pr-url> --repo-path <local-path>
```

`spawn.ts` handles: UUID session ID generation, `--worktree` for branch isolation, tmux layout computation, and state tracking. The first pane splits right (70% width). Panes 2-3 stack vertically. Pane 4+ starts a new column.

Before spawning the first pane, resize the orchestrator to a sidebar:

```bash
tmux resize-pane -t $TMUX_PANE -x 30%
```

## Monitor

#### Summary

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/state.ts list
```

#### Sync Completed Reviews

Detect exited panes and mark them completed:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/state.ts sync
```

#### Quick Glance

```bash
tmux capture-pane -t <pane_id> -p -S -50
```

#### Deep Inspection via JSONL

Each session's logs are at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. The encoded path replaces non-alphanumeric characters with `-` and prefixes with `-`. Since review sessions use `--worktree`, the CWD is the worktree path (not the repo root). Discover the JSONL path by globbing:

```bash
ls ~/.claude/projects/*/<session-id>.jsonl
```

Query with jq for latest activity, tool calls, or errors.

## Lifecycle

Periodically run `state.ts sync` to detect completed reviews. When all reviews are done, present a summary of what was reviewed and any remaining items in the queue.
