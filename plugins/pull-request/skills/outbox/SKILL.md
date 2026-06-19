---
name: pull-request:outbox
description: >
  Ranked needs-action feed of your own open PRs and MRs across GitHub and GitLab, with per-item babysit dispatch.
  Use to triage your authored work, find which PR needs you next, or batch-shepherd open PRs toward merge.
disable-model-invocation: true
allowed-tools:
  - Monitor
  - TaskStop
  - Agent
  - Skill(pull-request:babysit)
  - Skill(gitlab:merge-request)
  - Bash(gh:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
  - Bash(jq:*)
---

# Outbox

The authored half of the inbox/outbox pair. Where `review:inbox` orchestrates the PRs waiting on *your review*, outbox ranks the PRs *you authored* by what needs you next and dispatches a `pull-request:babysit` watcher per item. babysit shepherds one PR; outbox is the fleet dispatcher above it.

You are the orchestrator: fetch your open PRs/MRs, rank them, and hand the ones that need attention to babysit.

## Queue Sources

One command per platform, each emitting a JSON array of `ActionEntry`:

```
{ url, platform, ci, review, isDraft, updatedAt }
```

`ci` is `red | green | pending | none`; `review` is `changes_requested | approved | review_required | none`. Each source owns its own query and field mapping; the feed only ranks the union.

#### GitHub

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/github-queue.ts
```

Lists your open authored PRs (`gh search prs --author=@me --state=open`) and enriches each with `gh pr view --json statusCheckRollup,reviewDecision,isDraft,updatedAt`.

#### GitLab

Delegate to the gitlab plugin, which owns the authored-MR query. Pass `bun <ABS>`, where `<ABS>` is the absolute path that resolves for `gitlab/skills/merge-request/scripts/authored-queue.ts` (for example `/Users/you/.claude/plugins/cache/.../gitlab/skills/merge-request/scripts/authored-queue.ts`). Write the path out in full. `${CLAUDE_SKILL_DIR}` points at this outbox skill, so it resolves to the wrong directory for the gitlab source. Omit this source when you have no GitLab work.

## Ranking

Each entry falls into the single highest-priority bucket it qualifies for, ranked:

`red CI` > `changes requested` > `stale-green` > `awaiting review` > `draft`

A red CI outranks everything, so a draft or changes-requested PR with failing CI still leads. Stale-green is a PR whose CI is green but that has gone untouched past `--stale-days` (default 2): it is waiting to be merged or has been forgotten. Anything green, fresh, and unblocked falls into a no-action bucket, counted but kept out of the feed. Within a bucket, the oldest-updated item leads.

`rank.ts` holds the classification and ordering. `red CI` first folds CI-failure triage into the feed: the top of the ranking is the PR whose build is broken.

## Interactive Mode

The default: fetch once, rank, present, ask. Run a single pass:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/poll.ts \
  --data-dir ${CLAUDE_PLUGIN_DATA} \
  --queue "bun ${CLAUDE_SKILL_DIR}/scripts/github-queue.ts" \
  --queue "bun <ABS>"
```

`poll.ts` ranks the union, overwrites `needs-action.md` in `${CLAUDE_PLUGIN_DATA}/pull-request-outbox/` (top item first), and prints the actionable URLs not yet dispatched. Read `needs-action.md`, present it as a table, and ask which PRs to babysit. Then [dispatch a watcher](#dispatch-a-watcher) for each chosen item.

A source that fails emits a `{"type":"source-error",...}` line to stderr and contributes zero entries, so one platform's outage never blanks the feed.

## Dispatch a Watcher

For each PR to shepherd, spawn a background `Agent` that invokes babysit, then record the dispatch so the feed stops surfacing it:

1. Spawn an `Agent` whose prompt invokes `pull-request:babysit <url> --merge`. babysit is session-scoped and owns its own `Monitor` watcher, so running it inside a backgrounded Agent lets outbox keep ranking while the watch persists in the Agent.
2. Record it:

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts <url> --data-dir ${CLAUDE_PLUGIN_DATA}
   ```

`poll.ts` and the watch loop both filter dispatched URLs, so a PR already being shepherded never gets a second watcher. babysit keeps no shared run-state, so this dispatched set is how outbox dedupes. It persists in the data dir across sessions. Clear it at the start of a fresh hands-off session if you want every open PR reconsidered:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts --reset --data-dir ${CLAUDE_PLUGIN_DATA}
```

## Hands-Off Mode (Monitor Loop)

The opt-in unattended mode, fired from a morning routine. It polls your authored queues on an interval and dispatches babysit for each newly-actionable PR without prompting, so the feed drains itself while you work elsewhere.

`watch.ts` owns the loop: each interval it ranks the queues, overwrites `needs-action.md`, and prints one URL per newly-actionable PR not already dispatched. Each printed URL is one event you react to by [dispatching a watcher](#dispatch-a-watcher).

Pass this command to `Monitor` with `persistent: true` and a descriptive label. `${CLAUDE_SKILL_DIR}` is outbox's own directory; the GitLab `--queue` uses a full absolute path:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts \
  --data-dir ${CLAUDE_PLUGIN_DATA} \
  --interval 300 \
  --queue "bun ${CLAUDE_SKILL_DIR}/scripts/github-queue.ts" \
  --queue "bun <ABS>"
```

#### Monitor Reliability

Two rules for any command you hand `Monitor`:

- Pass a **single long-lived process** that sleeps internally via `setTimeout`, not a shell `while/sleep` loop. This works around a macOS `Monitor` bug: the eval context strips `PATH` (so `sleep` and `date` are not found) and kills backgrounded children with `nice(5) failed: operation not permitted`. `watch.ts` already does this.
- **Never suppress poll output** with `>/dev/null` or `|| true`. A silent poll is indistinguishable from "nothing new"; the sources emit a structured error line instead.

#### Pacing and Stopping

- A 300s interval is a reasonable floor. Authored PRs change over minutes-to-hours, and the queue sources hit rate-limited remote APIs. Shorten only when you expect a burst.
- Call `TaskStop` on the `Monitor` task to stop early.
- The loop runs until you stop it. Surface a summary when nothing is actionable across several consecutive intervals, but keep polling unless told otherwise (a fresh red CI can re-add a PR anytime).

## Relationship to babysit

outbox composes babysit; it does not reimplement it. Everything about a single PR's CI watch, trivial-fix loop, and merge drive lives in babysit. outbox decides *which* PRs to hand it and *in what order*. Keep `code-review` and `simplify` out of this path: self-review stays a deliberate pre-create gate, never an automatic step in the feed.
