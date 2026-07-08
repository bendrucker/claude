---
name: improve-claude-code
disable-model-invocation: true
description: |
  Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo, discover improvement candidates from session history, or watch open PRs to implement review feedback and close shipped todos.
  Use when the user wants to work on their Claude Code improvement backlog, process Things todos tagged claude-code, batch-implement configuration changes, mine session history for grounded config-change candidates (Discover mode), or watch this skill's open PRs for review feedback and merges (Watch mode).
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(claude-code:session)
  - Skill(pull-request:create)
  - Skill(code-review)
  - Skill(github:actions-monitor)
  - Skill(github:pr-comments)
---

# Improve Claude Code

Work through the `claude-code` Things backlog: fetch todos, triage with the user, then plan and implement each in parallel as separate PRs.

The backlog has two sources. The user files todos tagged `claude-code` by hand (and `agent-ideas` files external-harvest ideas in the same shape). **Discover mode** adds a second source: it mines this machine's session history for config-change candidates, grounds them against the live config, and files the keepers as `claude-code` todos. Both sources feed the one implement loop below. Discover is upstream of triage, not a replacement.

**Watch mode** is the downstream follow-on. Once PRs exist, it tracks them under `/loop`, implements review feedback as it lands, and closes each backing todo on merge. See [Watch](#watch).

**Sweep mode** is the destructive counterpart to Discover: it proposes stale or graduated memories for retirement and deletes only what you approve. It is interactive-only and never runs unattended. See [Sweep](#sweep).

In every mode, the loop itself is in scope: this skill's own SKILL.md, the `claude-code:session` skill's queries and views, and the Things scripts the loop depends on. Findings in that class may be dispatched to background worktree agents immediately, even when everything else routes to planning or triage discussion.

All Things interaction goes through the `things:jxa` and `things:url` skills (never inline JXA). PRs go through `pull-request:create` (never `gh pr create`).

## Discover

Mine session history for improvement candidates, ground them against the live config, write a digest, and file the keepers. Interactive Discover never auto-files: filing is an explicit user choice. The one exception is [Scheduled](#scheduled), the unattended variant, which auto-files high-confidence grounded candidates. Implementing is a separate run of the loop below, unless the user opts into [Direct Implementation](#direct-implementation) for the run. The engine is the `claude-code:session` skill's fan-out, whose `references/discovery.md` carries the recipe (dimension cheat sheet, grounding mandate, host safety, Tier-2 catalog). Load that skill to read it.

#### Refresh

Run the session skill's `scripts/refresh.ts --refresh` once, alone (it takes an exclusive write lock), and capture the printed `$DB` path. Hand that path to every agent, and never let a fanned-out agent refresh.

#### Fan-Out

Launch one `Task` agent per dimension (hook latency, hook blocks, permissions and sandbox, context tax, tokens, turns and compaction, skill economy), the same mining fan-out `agent-ideas` uses. Give each agent the `$DB` path and point it at `references/discovery.md`. Each agent runs its dimension's named queries (by name, read-only) plus any inline rollups, and returns structured candidate findings **plus the exact SQL it ran**. Read-only opens take no lock, so agents never contend.

#### Grounding

Mandatory. Launch one or more grounding agents that re-check every candidate against the live files under `/Users/ben/src/bendrucker/claude`. Drop anything the config already addresses. Downgrade anything thin or host-skewed. Carry `grounded` (boolean) and `confidence` (high/medium/low) per candidate. Raw query findings go stale within a week against a config that changes weekly: a prior run overturned four of its own headline findings. See the grounding rules in `references/discovery.md` (hooks run in parallel, so never sum durations as wall-clock, and split friction into what a setting can fix and what it cannot).

#### Dedup

Fingerprint each candidate (see [Fingerprint](#fingerprint)). Then query Things via `things:jxa` for every `claude-code`-tagged todo and recently-completed (logbook) todo, and scan their notes for `Discovery: <fp>`. Mark each candidate:

- `already-filed`: fingerprint found in an open `claude-code` todo.
- `already-shipped`: fingerprint found in a completed todo (the annotate phase removes the `claude-code` tag on a shipped todo, so the marker persists in notes or the logbook).
- `new`: fingerprint not found.

Suppress `already-filed` and `already-shipped` from the actionable set; still count them in the digest tail. Things is the ledger: no separate dedup store.

#### Digest

The only guaranteed output. Write `tmp/claude-discovery-digest-<YYYY-Www>.md`, ranked and grouped high to low confidence. Each entry shows the finding, its grounding note, the SQL that produced it, and its dedup status. Default `host=local` for config-change candidates; cite imported hosts as corroborating counts only, never pasting raw `content`/`command`/`stdout` from an egress-blocked host (see host safety in `references/discovery.md`). **Never auto-file from this step in an interactive run.** Only the [Scheduled](#scheduled) path files without asking, and it files after the digest lands.

#### File the Keepers

Present the actionable (new, grounded) candidates and ask the user which to file (numbers, ranges like `1-3`, or `all`), mirroring the triage UX below. For each selected candidate, create one Things todo via `things:url`, tagged `claude-code`:

- **Title**: `[discovery] <finding title>`
- **Notes**: the pitch, then the SQL/evidence, then `Discovery: <fingerprint>` on its own line.

One todo per candidate, not one blob. Filing lands findings in the same backlog the implement loop drains.

#### Hand Off

Report how many todos landed. The existing triage, plan, implement, PR, CI, and annotate phases run on them later, unchanged. Filing is the default terminal action of Discover mode. Implementing is a separate, explicit choice: run the loop below when ready, or opt into [Direct Implementation](#direct-implementation) at the start of a run.

#### Direct Implementation

Implement-as-you-go is an opt-in alternative to filing, chosen explicitly by the user per run. When the user asks for direct implementation, dispatch one background `general-purpose` agent with `isolation: "worktree"` for each grounded finding as soon as it lands, while the rest of the run continues. Each agent folds grounding in: it verifies the finding against the live config first, and if the config already addresses it, reports "not grounded" and changes nothing. Otherwise it implements, tests, runs `/code-review`, and opens a PR via `pull-request:create`. Collect the PR links at the end for the user to review locally or on GitHub.

These PRs have no backing Things todo, so skip the `Original Task` link. Instead the body carries an Evidence section (local-host evidence only, never content from an egress-blocked host) plus one `Discovery: <fingerprint>` line per finding. Dedup today scans only Things notes, so these markers stay invisible until that scan is extended to PR bodies. Until then, a finding implemented this way can resurface as `new` on the next run.

#### Scheduled

Invoked as `discover --scheduled`, this is the unattended weekly variant. It runs the same refresh, fan-out, grounding, dedup, and digest pipeline as an interactive run. After the digest is written, it auto-files every candidate that is `new`, `grounded`, and `confidence == high` as a `claude-code` Things todo via `things:url`, using the exact title, notes, and `Discovery: <fingerprint>` format from [File the Keepers](#file-the-keepers). Medium and low confidence candidates land in the digest only. Because dismissal is not tracked, they resurface as `new` on the next run, where an interactive pass can file them.

A scheduled run never prompts (no `AskUserQuestion`), never implements ([Direct Implementation](#direct-implementation) is interactive-only), and ends after reporting how many todos it filed. Everything downstream is unchanged: the filed todos wait in the same backlog for a later interactive triage and implement pass.

#### Cadence

On-demand is primary: invoke this skill in Discover mode at your terminal. The weekly run is committed infrastructure: `user/launchd/me.bendrucker.claude.discover.plist` runs `discover --scheduled` Mondays at 07:23 on the always-on Mac Studio (install and log instructions in `user/launchd/README.md`). It must run **locally** because the session DB and the `duckdb` CLI live on that machine, so the `agent-ideas` headless-then-teleport bridge does not apply (that works only because RSS is public).

#### Fingerprint

The dedup identity. Compute `sha256(finding_type + '|' + normalized_target)` truncated to 12 chars:

```bash
printf '%s' "hook-noop|team-workaround.ts" | shasum -a 256 | cut -c1-12
```

- `finding_type` is a stable slug for the class of finding (`hook-noop`, `permission-allowlist-miss`, `repeat-read`, `sandbox-deny`).
- `normalized_target` is the config object the finding is about (a hook script basename, a permission pattern, a skill name), **never** a count or a date, so re-runs of the same underlying finding collapse to one identity.

Filed todos carry `Discovery: <fingerprint>` in notes. The dedup step extracts those markers from Things and suppresses matches. Suppressing *dismissed* findings (surfaced but not filed) is deferred: dismissed findings reappear as `new` until filed.

## Fetch and Triage

Use `things:jxa` to find all open todos tagged `claude-code`. Display a numbered table:

| # | Title | Notes (first line) | List |
|---|-------|--------------------|------|

Ask the user which items to work on (numbers, ranges like `1-3`, or `all`). Cap each batch at 3 to keep parallel agents manageable. Split larger selections automatically.

## Session Context

Each todo's notes embed the originating session as `Session: <uuid>`. For every selected todo, parse that UUID and use the `claude-code:session` skill to pull the original context: what you were doing, the commands that ran, and the errors that prompted the todo. This is richer than the todo's prose summary and grounds each plan in the real failure.

Refresh the index once (`refresh.ts --refresh`), then look up each todo's session over the shared file with `duckdb -readonly "$DB"` (see the session skill's "Parallel queries" section). Read-only opens take no lock, so a batch of lookups runs concurrently without contending; never re-refresh per todo. Query `messages` / `content_items` / `text_content` filtered by `WHERE session_id = '<uuid>'`. Do not filter by `host`: many todos come from the work machine, whose corpus is imported as a separate host, and omitting the filter spans every machine. Distill the result to a few lines per todo and pass it to the matching `Plan` agent with the title and notes.

If the UUID is absent from the index (not yet imported, or the index needs a refresh), proceed with notes only and say so for that todo.

#### Egress

Session context informs local planning only. Imported hosts may be marked `block_egress`, so never paste session-derived content into PR bodies or any other output that leaves the machine.

## Plan

Launch parallel `Plan` agents (one per todo). Give each the todo title, full notes, the session context from the previous step, and instruction to explore the repo and produce an implementation plan.

Point agents to relevant domain skills: `claude-code:skill` for skill changes, `claude-code:hook` for hooks, `bun:bun` for scripts.

Present all plans. For each, propose a `/code-review` effort (typically `low`; `medium` for changes touching multiple plugins) and confirm via `AskUserQuestion` alongside plan approval.

## Implement

For each approved plan, launch a background `general-purpose` agent with `isolation: "worktree"`. Each agent implements the plan, runs `bun test`, runs `/code-review <effort>` with the level chosen during planning, commits, and creates the PR via `pull-request:create`. Pass the same domain skills from the planning step.

#### PR body

Include an `Original Task` link so the PR traces back to the Things todo:

```
Original Task: [<todo-title>](https://things.bendrucker.me/show?id=<todo-id>)
```

## Monitor CI and Fix Failures

Use `github:actions-monitor` agents (one per PR) to collect pass/fail status. For failures, launch a worktree agent with the logs and branch to fix, test, and push. Re-monitor after fixes.

## Annotate Things

Use `things:url` to update each todo based on its PR outcome:

- **Passing**: Append PR link to notes, add `review` tag, remove `claude-code` tag, move to Anytime
- **Failing**: Append PR link and failure summary to notes. Leave `claude-code` tag so it resurfaces next run.

## Summary

Output a bulleted list (one entry per todo): PR link (pass/fail), Things URL (`https://things.bendrucker.me/show?id=<todo-id>`), title.

## Watch

A follow-on mode for the PRs this skill opened. Run it under `/loop` self-paced so each tick re-checks every open PR from the batch, acts on new review feedback and merges, then sleeps. Watch implements requested changes and pushes them. It never merges for you, and it ends the loop once every tracked PR is merged or closed.

Invoke as `/loop /improve-claude-code watch`. Recover the PR-to-todo mapping from each PR's `Original Task` link.

#### Each Tick

Walk every open tracked PR once and handle its state:

- CI red: launch a worktree agent with the failing logs and branch to fix, test, and push, the same as [Monitor CI and Fix Failures](#monitor-ci-and-fix-failures).
- A reviewer thread requests a change: launch a worktree agent to implement it, run `bun test` and `biome check`, then commit and push. Reply to the thread naming the change and its commit. Leave the thread unresolved for the reviewer, and do not merge.
- Merged: close the backing Things todo. Append the PR link, mark it completed, and remove the `claude-code` tag via `things:url`.
- Closed without merging: leave the todo tagged `claude-code` with a note so it resurfaces next run.

Fetch reviewer threads with the `github:pr-comments` script (`--role reviewer --include-resolved`), never a hand-authored GraphQL query. Report one status line per PR each tick.

#### Guardrails

Auto-implement covers review changes and CI fixes only. A reviewer question or design objection pauses for you with the thread quoted, no edit.

Every push re-runs CI, so a PR often carries across ticks rather than resolving in one pass. That is expected under `/loop`.

## Sweep

Retire memories that have graduated or gone stale. Sweep enumerates the memory store, classifies each memory by type, and proposes deletions for your approval. Invoke it as `/improve-claude-code sweep`.

Sweep is the destructive counterpart to Discover. Discover only adds Things todos, so it can run unattended. Sweep removes files from a store that is **not under version control**, so every deletion is irreversible. Both classification signals are fuzzy heuristics: a merged PR does not prove a project is finished, and a nearby rule does not prove a lesson is enforced. So every verdict is a proposal, never an automatic delete. Sweep never runs in the `discover --scheduled` path and never deletes or files without asking.

#### Enumerate

List every `*.md` under `/Users/ben/.claude/projects/-Users-ben-src-bendrucker-claude/memory/` except `MEMORY.md` (the index, which Sweep edits but never deletes). Parse each file's YAML frontmatter and read its `type`, handling both shapes present in the store: the flat `type: feedback` and the nested `metadata: { type: ... }`. Branch on the type.

#### Project Memories

A project memory graduates once its work has shipped and left nothing live behind.

- Extract cited PR numbers from the body with `#?(\d+)`. No PR numbers means nothing to check against, so keep.
- Check each cited PR with `gh pr view <n> --json state,mergedAt`. If any cited PR is not merged, keep.
- All merged: scan the body for forward-looking state that outlives the merge, matching the keywords `unbuilt`, `not yet`, `follow-up`, `future`, `remaining`, `removal criteria`, `known issues`, `TODO`, and `still`. On a match, keep and note it as "merged but has open follow-ups" so the residual work stays visible.
- Merged with no residual state: propose delete.

#### Feedback Memories

A feedback memory graduates once its lesson is enforced by a rule or hook, at which point the memory duplicates the enforcement.

- Search for an encoding of the same lesson across `.claude/rules/`, `user/rules/`, the hooks blocks in `.claude/settings.json`, and the enforcement skills, matching the memory's title and description on keyword and concept rather than exact string. If enforced, propose delete: the rule now carries the lesson.
- Not enforced but encodable (the lesson is expressible as a rule or hook): keep the memory and file an `encode` todo (see [Encode Todos](#encode-todos)). The memory stays until the enforcement exists.
- Not encodable (taste or judgment that resists a mechanical rule): keep. There is nowhere for it to graduate to.

#### User and Reference Memories

Never touched. Sweep does not classify or propose `type: user` or `type: reference` memories.

#### Encode Todos

When a feedback memory is encodable but unenforced, file a Things todo via `things:url`, tagged `claude-code`, so the lesson can become a rule later:

- **Title**: `[encode] <memory title>`
- **Notes**: the lesson, then the candidate target (the rule file or hook that should carry it), then a `Discovery: <fingerprint>` line (see [Fingerprint](#fingerprint)) so [Dedup](#dedup) suppresses a duplicate on the next Discover or Sweep run.

Encode todos are filed independently of the deletion approval. The memory is kept, so filing does not wait on your selection.

#### Propose and Approve

Present the propose-delete candidates as a numbered table, mirroring [File the Keepers](#file-the-keepers):

| # | File | Type | Signal | Reason |
|---|------|------|--------|--------|

The signal is what triggered the proposal (all cited PRs merged, or lesson enforced by `<rule>`). The reason is one line. Use `AskUserQuestion` to collect the selection (numbers, ranges like `1-3`, `all`, or `none`). Only selected files are deleted. List the kept-with-note memories (merged but with open follow-ups) below the table so nothing that looked done disappears silently, and keep them out of the deletable set.

#### Delete

Deletion runs only on approved files, as your own Edit and Bash actions in the flow, never a standalone unattended `rm` script. For each approved file, two coupled edits:

- Before deleting, grep the store for inbound `[[wikilinks]]` to the file's basename. If another memory links to it, report the referrers so you can decide whether the link should survive the deletion.
- Remove the memory file with `rm`.
- Edit `MEMORY.md` to drop the memory's line, matching on the `(<basename>.md)` in its link target.

Keep the file removal and the index edit together. A deleted memory whose `MEMORY.md` line lingers is a broken link.

#### Summary

Report the counts: N memories deleted, M encode todos filed, K kept with an open-follow-up note. List each so the outcome is auditable.

#### Cadence

Monthly and on-demand. Sweep is interactive only: it always prompts and never runs under `discover --scheduled` or any other unattended path. Run it at your terminal when the store has accumulated enough graduated memories to be worth a pass.
