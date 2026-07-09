---
name: review:inbox
description: >
  Dispatch inbound pull request reviews as background sessions that collect in
  `claude agents`. Use when reviewing multiple PRs, checking the review queue,
  batch reviews, or managing your review inbox across GitHub and GitLab.
  Pass --queue to dispatch an already-ordered queue.
argument-hint: "[--queue]"
disable-model-invocation: true
allowed-tools:
  - Monitor
  - TaskStop
  - Skill(gitlab:merge-request)
  - Bash(gh:*)
  - Bash(claude:*)
  - Bash(jq:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
---

# Review Inbox

Dispatch inbound PR/MR reviews as background sessions. Each review runs as its own `claude --bg --agent review <url>` session, collected in the `claude agents` view. You fetch the pending queue and dispatch. Monitoring, completion, and worktree isolation belong to the agent view and the harness, not to you.

## Arguments

- `--queue`: dispatch an already-triaged, ordered queue handed in by a caller, rather than fetching your own. Default: off, the interactive flow that fetches and presents the queue below.

## Curated Queue

When `--queue` is set, another skill has already gathered, triaged, and ordered the reviews.

Skip [Fetch Pending Reviews](#fetch-pending-reviews) and [Present Results](#present-results). Take the queue from the invoking context as given and dispatch each review in the order received. If the caller supplies a permission mode, forward it to `spawn.ts` via `--permission-mode`. Everything from [Dispatch Review Sessions](#dispatch-review-sessions) onward is unchanged.

## Fetch Pending Reviews

Both fetches return the `UNREVIEWED` bucket: PRs/MRs awaiting your first review. Approving, requesting changes, or starting a review drops an item. A re-request re-adds it.

#### GitHub

```bash
gh search prs --review-requested=@me --state=open --json number,title,url,repository
```

`--review-requested=@me` already scopes to UNREVIEWED: GitHub drops a PR once you approve or request changes and re-adds it when re-requested.

#### GitLab

Load `gitlab:merge-request` and run its `review-queue` command for the UNREVIEWED MRs across all projects. It emits `[{ url, reference, title }]` as JSON. The query and its review-state filter are documented and owned by the gitlab plugin; the inbox only delegates to it.

### Present Results

Combine results from both platforms into a summary table. Ask which reviews to start.

## Dispatch Review Sessions

For each selected review:

#### Resolve the Local Repo Path

The `review` agent checks out the PR branch with `gh pr checkout`, so the session runs inside a local clone of the PR's repo. Ask where the repo is cloned. If it is not cloned, clone it first. The path is required to dispatch.

#### Dispatch

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/spawn.ts <pr-url> --repo-path <local-path> --data-dir ${CLAUDE_PLUGIN_DATA}
```

`spawn.ts` runs `claude --bg --agent review <pr-url>` in the repo clone. The session collects in `claude agents`. On its first write (the review agent's `gh pr checkout`) the harness moves it into an isolated worktree, so parallel reviews never share a working tree. `spawn.ts` records the launched session in a dedup set and refuses a URL it has already dispatched, so a re-dispatch is a no-op.

Pass `--permission-mode <default|acceptEdits|plan|bypassPermissions>` to set the dispatched session's permission mode. Omit it to keep Claude's default.

## Monitor

Reviews collect in the agent view. Manage them there, not here:

- `claude agents` (or the `ca` alias) opens the live view, grouped into needs-input, working, and completed.
- `claude agents --json` lists sessions for scripting.
- `claude logs <id>`, `claude attach <id>`, and `claude stop <id>` inspect or control one session.

To see what this inbox has dispatched and cross-reference session ids:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatched.ts list --data-dir ${CLAUDE_PLUGIN_DATA}
```

## Lifecycle

A dispatched review runs to completion on its own and cleans up its own worktree. The inbox does not track or reclaim it. The dedup set only prevents double-dispatch. Manage it directly when needed:

- `dispatched.ts --reset` clears the set at the start of a fresh inbox session, so a re-requested review can dispatch again.
- `dispatched.ts remove --url <pr-url>` untracks a single review.

When you have dispatched the selected queue, present a summary of what you sent and point at `claude agents` for progress.

## Monitor Loop (Hands-Off)

The interactive flow above is the default: fetch once, present, ask, dispatch. The loop is the opt-in hands-off mode. It polls the UNREVIEWED queues on an interval and dispatches a session for each newly-arrived review without prompting, so the queue drains itself while you work elsewhere.

The `Monitor` command does the polling and emits one line per newly-arrived review. You react to each event by dispatching. `watch.ts` owns the loop: each interval it reads the dedup set, runs each `--queue` source command, and prints the URLs not already dispatched. `Monitor` is not a bare metronome.

#### Wire the Review-Queue Sources

`poll.ts` knows no platforms. Each `--queue` is a command that emits an UNREVIEWED queue as `[{ url }]` JSON. Pass one per platform you want polled, and omit the rest:

- GitHub: `gh search prs --review-requested=@me --state=open --json url`.
- GitLab: load `gitlab:merge-request` and pass `bun <ABS>`, where `<ABS>` is the absolute path the gitlab docs resolve to for `scripts/review-queue.ts` (for example `/Users/you/.claude/plugins/cache/.../gitlab/skills/merge-request/scripts/review-queue.ts`). Write the resolved path out in full. Do not reuse `${CLAUDE_SKILL_DIR}` from the examples below: it points at this inbox skill, not gitlab, so it resolves to the wrong directory.

A platform plugin that owns its queue keeps the query; the inbox only runs the command it hands back.

#### Arm the Monitor

Pass this command to `Monitor` with `persistent: true` and a descriptive label. `watch.ts` runs a single long-lived bun process: each iteration fetches all `--queue` sources and prints one URL per line per newly-arrived review. Each printed URL is one event.

`${CLAUDE_SKILL_DIR}` below is the inbox's own directory (where `watch.ts` lives). The GitLab `--queue` uses a full absolute path instead, since it points into a different skill:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts \
  --data-dir ${CLAUDE_PLUGIN_DATA} \
  --interval 300 \
  --queue "gh search prs --review-requested=@me --state=open --json url" \
  --queue "bun <ABS>"
```

A failed source emits a `{"type":"source-error",...}` line to stderr and contributes zero URLs, so one source's outage never stalls the loop. It is not suppressed.

#### Monitor Reliability

Two rules for any command you hand `Monitor`:

- Pass a **single long-lived process** that sleeps internally via `setTimeout`, not a shell `while/sleep` loop. This is a temporary workaround for a macOS `Monitor` bug: the eval context strips `PATH` (so `sleep` and `date` are not found) and kills backgrounded children with `nice(5) failed: operation not permitted`. When that harness bug is fixed, shell loops work again.
- **Never suppress poll output** with `>/dev/null` or `|| true`. A silent poll is indistinguishable from "nothing new". Emit a structured line on error so failures are visible.

#### React to Each Event

For each emitted URL, dispatch a session without prompting, reusing [Resolve the Local Repo Path](#resolve-the-local-repo-path). If the caller supplied a permission mode, forward it to `spawn.ts` via `--permission-mode`. In unattended runs there is no one to answer the clone prompt, so skip any review whose repo is not cloned locally and report it rather than blocking the loop. `spawn.ts` refuses a URL already dispatched, so a URL re-emitted before its `spawn.ts` lands is a no-op.

#### Pacing and Stopping

- A 300s interval is a reasonable floor. Reviews arrive over minutes-to-hours, and the queue sources hit rate-limited remote APIs. Shorten only when you expect a burst.
- Call `TaskStop` on the `Monitor` task to stop early.
- The loop runs until you stop it. Surface a summary when the queue is empty across several consecutive intervals, but keep polling unless told otherwise (a re-request can re-add a review anytime).
