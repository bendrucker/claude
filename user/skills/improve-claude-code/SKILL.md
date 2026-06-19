---
name: improve-claude-code
disable-model-invocation: true
description: |
  Triage and batch-implement Claude-tagged Things todos as PRs for the claude config repo, or discover improvement candidates from session history.
  Use when the user wants to work on their Claude Code improvement backlog, process Things todos tagged claude-code, batch-implement configuration changes, or mine session history for grounded config-change candidates (Discover mode).
allowed-tools:
  - Skill(things:jxa)
  - Skill(things:url)
  - Skill(claude-code:session)
  - Skill(pull-request:create)
  - Skill(code-review)
  - Skill(github:actions-monitor)
---

# Improve Claude Code

Work through the `claude-code` Things backlog: fetch todos, triage with the user, then plan and implement each in parallel as separate PRs.

The backlog has two sources. The user files todos tagged `claude-code` by hand (and `agent-ideas` files external-harvest ideas in the same shape). **Discover mode** adds a second source: it mines this machine's session history for config-change candidates, grounds them against the live config, and files the keepers as `claude-code` todos. Both sources feed the one implement loop below. Discover is upstream of triage, not a replacement.

All Things interaction goes through the `things:jxa` and `things:url` skills (never inline JXA). PRs go through `pull-request:create` (never `gh pr create`).

## Discover

Mine session history for improvement candidates, ground them against the live config, write a digest, and file the keepers. Discover never auto-implements and never auto-files: filing is an explicit user choice, implementing is a separate run of the loop below. The engine is the `claude-code:session` skill's fan-out, whose `references/discovery.md` carries the recipe (dimension cheat sheet, grounding mandate, host safety, Tier-2 catalog). Load that skill to read it.

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

The only guaranteed output. Write `tmp/claude-discovery-digest-<YYYY-Www>.md`, ranked and grouped high to low confidence. Each entry shows the finding, its grounding note, the SQL that produced it, and its dedup status. Default `host=local` for config-change candidates; cite imported hosts as corroborating counts only, never pasting raw `content`/`command`/`stdout` from an egress-blocked host (see host safety in `references/discovery.md`). **Never auto-file from this step.**

#### File the Keepers

Present the actionable (new, grounded) candidates and ask the user which to file (numbers, ranges like `1-3`, or `all`), mirroring the triage UX below. For each selected candidate, create one Things todo via `things:url`, tagged `claude-code`:

- **Title**: `[discovery] <finding title>`
- **Notes**: the pitch, then the SQL/evidence, then `Discovery: <fingerprint>` on its own line.

One todo per candidate, not one blob. Filing lands findings in the same backlog the implement loop drains.

#### Non-Interactive Run

A scheduled local run (a Claude Code Desktop scheduled task firing `/improve-claude-code discover`) has nobody at the keyboard for the [File the Keepers](#file-the-keepers) prompt, so it ends one step short of filing. Everything upstream runs unchanged: refresh the index, fan out the dimensions, and run the mandatory grounding pass. The verifier split stays exactly as it is on-demand. Skipping it would file week-stale findings against a config nobody re-checked.

Write the digest to `tmp/claude-discovery-digest-<YYYY-Www>.md` as always. Then, in place of the prompt, file exactly one Things doorway item that summarizes the run and hands triage back to you on demand. The run still never auto-files keepers. The doorway hands the filing choice back to you.

Create the item via `things:url`, left untagged so the digest does not land in the `claude-code` backlog as one blob:

- **Title**: `[discovery] Weekly digest: N candidates (YYYY-Www)`
- **Notes**: the top-line summary (actionable count and the high-confidence standouts), then the digest path on its own line, then a one-line prompt to run `improve-claude-code` in Discover mode to file the keepers.

When you pick the item up, re-run the skill interactively and flow through [File the Keepers](#file-the-keepers) against the same digest. The doorway item is the run's only signal. If creating it fails, say so loudly in the run output rather than ending silently.

#### Hand Off

Report how many todos landed. The existing triage, plan, implement, PR, CI, and annotate phases run on them later, unchanged. Filing is the default terminal action of Discover mode; implementing is a separate, explicit choice (run the loop below when ready).

#### Cadence

On-demand is primary: invoke this skill in Discover mode at your terminal and file keepers through the prompt. The weekly run is the [Non-Interactive Run](#non-interactive-run) above, and it must fire **locally**. The session DB and the `duckdb` CLI live on this Mac, so a cloud `/schedule` routine cannot reach them. Routines run in Anthropic's cloud from a fresh repo clone, with no local filesystem or CLI access. The `agent-ideas` headless-then-teleport bridge does not apply either (that works only because RSS is public).

The trigger is a Claude Code Desktop scheduled task: on the Routines page, add a routine that runs `/improve-claude-code discover` weekly in Local mode. It runs on this Mac with full filesystem and `duckdb` access. It fires only while the Desktop app is open and the machine is awake. The routine is configured in the Desktop app, so nothing in this repo or dotfiles carries it. If you need the run to fire with the app closed, the fallback is a launchd job running `claude -p "/improve-claude-code discover"`, and that plist belongs in the dotfiles repo.

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
