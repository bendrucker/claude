---
name: review:inbox
description: >
  Live tmux inbox for reviewing inbound pull requests across GitHub and GitLab.
  Use when reviewing multiple PRs, checking the review queue, batch reviews, or managing your review inbox.
disable-model-invocation: true
allowed-tools:
  - Monitor
  - TaskStop
  - Skill(gitlab:merge-request)
  - Bash(gh:*)
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

# Review Inbox

Orchestrate live PR/MR reviews in tmux. You are the sidebar orchestrator: fetch pending reviews, spawn review sessions, and monitor their progress.

## Fetch Pending Reviews

Both fetches return the `UNREVIEWED` bucket: PRs/MRs awaiting your first review. Approving, requesting changes, or starting a review drops an item; a re-request re-adds it.

#### GitHub

```bash
gh search prs --review-requested=@me --state=open --json number,title,url,repository
```

`--review-requested=@me` already scopes to UNREVIEWED: GitHub drops a PR once you approve or request changes and re-adds it when re-requested.

#### GitLab

Load `gitlab:merge-request` and run its `review-queue` command for the UNREVIEWED MRs across all projects. It emits `[{ url, reference, title }]` as JSON. The query and its review-state filter are documented and owned by the gitlab plugin; the inbox only delegates to it.

### Present Results

Combine results from both platforms into a summary table. Ask which reviews to start.

## Spawn Review Sessions

For each selected review:

#### Resolve the Local Repo Path

Ask the user where the repo is cloned locally. If it's not cloned, clone it first. The repo path is required for spawning.

#### Spawn

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/spawn.ts <pr-url> --repo-path <local-path> --data-dir ${CLAUDE_PLUGIN_DATA} --context "<PR metadata: title, author, description summary>"
```

`spawn.ts` handles `--worktree` for branch isolation, tmux layout computation, and state tracking. Pass `--context` with PR metadata (title, author, description summary) so the spawned review session has immediate context. Panes cycle in groups of 3: one horizontal split (new column at 70% width for the first, equal width after), then two vertical splits stacking in the column.

Before spawning the first pane, resize the orchestrator to a sidebar:

```bash
tmux resize-pane -t $TMUX_PANE -x 30%
```

## Monitor

#### Summary

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/state.ts list --data-dir ${CLAUDE_PLUGIN_DATA}
```

#### Sync Completed Reviews

Detect exited panes, mark them completed, and prune their worktrees:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/state.ts sync --data-dir ${CLAUDE_PLUGIN_DATA}
```

When a review transitions `active → completed`, `sync` reclaims its worktree through Worktrunk: `spawn.ts` created the worktree as `wt switch --create <paneName>`, so `sync` removes it by that same stored branch (`wt remove <paneName> --force`) with no lookup. `wt remove` deletes the worktree (including untracked files), fires your `pre-remove` hooks, and drops the branch when it has no unmerged commits. `sync` prints `N completed, M worktrees removed` and surfaces any removal failures on stderr. A `pre-remove` hook that needs approval fails the removal (it surfaces in the failure list) rather than removing unattended; pre-approve with `wt config approvals add` to let the inbox reclaim those worktrees on its own.

#### Quick Glance

```bash
tmux capture-pane -t <pane_id> -p -S -50
```

#### Deep Inspection via JSONL

Each session's logs are at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. The encoded path replaces non-alphanumeric characters with `-` and prefixes with `-`. Since review sessions run in a Worktrunk worktree, the CWD is the worktree path, not the repo root. Discover the JSONL path by globbing:

```bash
ls ~/.claude/projects/*/<session-id>.jsonl
```

Query with jq for latest activity, tool calls, or errors.

## Lifecycle

Periodically run `state.ts sync` to detect completed reviews. When all reviews are done, present a summary of what was reviewed and any remaining items in the queue.

## Monitor Loop (Hands-Off)

The interactive flow above is the default: fetch once, present, ask, spawn. The loop is the opt-in hands-off mode. It polls the UNREVIEWED queues on an interval and spawns a session for each newly-arrived review without prompting, so the queue drains itself while you work elsewhere.

The `Monitor` command does the polling and emits one line per newly-arrived review; you react to each event by spawning. `watch.ts` owns the loop: each interval it syncs completed reviews, then runs the fetch-and-diff (read tracked URLs from state, run each `--queue` source command, print the URLs not already tracked). `Monitor` is not a bare metronome.

#### Wire the Review-Queue Sources

`poll.ts` knows no platforms. Each `--queue` is a command that emits an UNREVIEWED queue as `[{ url }]` JSON. Pass one per platform you want polled, and omit the rest:

- GitHub: `gh search prs --review-requested=@me --state=open --json url`.
- GitLab: load `gitlab:merge-request` and pass `bun <ABS>`, where `<ABS>` is the absolute path the gitlab docs resolve to for `scripts/review-queue.ts` (for example `/Users/you/.claude/plugins/cache/.../gitlab/skills/merge-request/scripts/review-queue.ts`). Write the resolved path out in full. Do not reuse `${CLAUDE_SKILL_DIR}` from the examples below: it points at this inbox skill, not gitlab, so it resolves to the wrong directory.

A platform plugin that owns its queue keeps the query; the inbox only runs the command it hands back.

#### Arm the Monitor

Pass this command to `Monitor` with `persistent: true` and a descriptive label. `watch.ts` runs a single long-lived bun process: each iteration syncs completed reviews, fetches all `--queue` sources, and prints one URL per line per newly-arrived review. Each printed URL is one event.

`${CLAUDE_SKILL_DIR}` below is the inbox's own directory (where `watch.ts` lives). The GitLab `--queue` uses a full absolute path instead, since it points into a different skill:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts \
  --data-dir ${CLAUDE_PLUGIN_DATA} \
  --interval 300 \
  --queue "gh search prs --review-requested=@me --state=open --json url" \
  --queue "bun <ABS>"
```

A failed source emits a `{"type":"source-error",...}` line to stderr and contributes zero URLs, so one source's outage never stalls the loop. Sync errors go to stderr as `{"type":"sync-error",...}`. Neither is suppressed.

#### Monitor Reliability

Two rules for any command you hand `Monitor`:

- Pass a **single long-lived process** that sleeps internally via `setTimeout`, not a shell `while/sleep` loop. This is a temporary workaround for a macOS `Monitor` bug: the eval context strips `PATH` (so `sleep` and `date` are not found) and kills backgrounded children with `nice(5) failed: operation not permitted`. When that harness bug is fixed, shell loops work again.
- **Never suppress poll output** with `>/dev/null` or `|| true`. A silent poll is indistinguishable from "nothing new"; emit a structured line on error so failures are visible.

#### React to Each Event

For each emitted URL, spawn a session without prompting, reusing [Resolve the Local Repo Path](#resolve-the-local-repo-path). In unattended runs there is no one to answer the clone prompt, so skip any review whose repo is not cloned locally and report it rather than blocking the loop. `spawn.ts` refuses a URL already tracked, so a URL re-emitted before its `spawn.ts` lands is a no-op.

#### Pacing and Stopping

- A 300s interval is a reasonable floor. Reviews arrive over minutes-to-hours, and the queue sources hit rate-limited remote APIs. Shorten only when you expect a burst.
- Call `TaskStop` on the `Monitor` task to stop early.
- The loop runs until you stop it. Surface a summary when the queue is empty across several consecutive intervals, but keep polling unless told otherwise (a re-request can re-add a review anytime).
