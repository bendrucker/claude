# Discover

Mine session history for improvement candidates, ground them against the live config, write a digest, and file the keepers as `claude-code` todos. Interactive runs never auto-file: filing is an explicit user choice, and only [Scheduled](#scheduled) files without asking. Implementing is a separate run of the main loop unless the user opts into [Direct Implementation](#direct-implementation) for the run. The engine is the `claude-code:session` skill's fan-out, whose `references/discovery.md` carries the recipe (dimension cheat sheet, grounding mandate, host safety, Tier-2 catalog). Load that skill to read it.

## Refresh

Run the session skill's `scripts/refresh.ts --refresh` once, alone (a refresh with work to do needs exclusive access to the database file), and note the DB path it prints. Never let a fanned-out agent refresh.

## Fan-Out

Launch one `Agent` call per dimension (hook latency, hook blocks, permissions and sandbox, context tax, tokens, turns and compaction, skill economy), the same mining fan-out `agent-ideas` uses. Point each agent at the session skill's `references/discovery.md` and the stable DB path. Each agent runs its dimension's named queries read-only plus any inline rollups, and returns structured candidate findings plus the exact SQL it ran. Read-only opens share the lock, so agents never contend.

## Grounding

Mandatory. Grounding agents re-check every candidate against the live files under `/Users/ben/src/bendrucker/claude`. Drop anything the config already addresses. Downgrade anything thin or host-skewed. Apply the harmony test from the repo's `CLAUDE.md`: a candidate that would fight a native Claude Code behavior gets reframed as an accommodation or a light-touch experiment with forward evaluation and removal criteria. Carry `grounded` (boolean) and `confidence` (high/medium/low) per candidate. Raw query findings go stale within a week against a config that changes weekly: a prior run overturned four of its own headline findings. Follow the grounding rules in `references/discovery.md` (hooks run in parallel, so never sum durations as wall-clock, and split friction into what a setting can fix and what it cannot).

## Dedup

Fingerprint each candidate (see [Fingerprint](#fingerprint)), then check both ledgers for the fingerprint: Things todos and the config repo's PR bodies. Direct-Implementation PRs carry the marker only in the PR body, so the Things scan alone misses them. Things and the PR history are the ledgers: no separate dedup store.

For Things, query via `things:jxa` for every `claude-code`-tagged todo and recently-completed (logbook) todo, and scan their notes for `Discovery: <fp>`.

For PR bodies:

```bash
gh api --paginate '/repos/bendrucker/claude/pulls?state=all&per_page=100' \
  --jq '.[] | (if .merged_at then "MERGED" elif .state == "closed" then "CLOSED" else "OPEN" end) as $s
        | (.body // "") | scan("Discovery: [0-9a-f]{12}") | "\($s) \(.)"'
```

Paginate rather than `gh pr list --limit <n>`, which silently drops every PR past the limit once the repo outgrows it.

Build a fingerprint-to-state map, strongest state wins (`MERGED` over `OPEN`), then mark each candidate:

- `already-shipped`: fingerprint in a `MERGED` PR body, or in a completed todo (annotate removes the `claude-code` tag on a shipped todo, so the marker persists in notes or the logbook).
- `already-filed`: fingerprint in an `OPEN` PR body, or in an open `claude-code` todo.
- `new`: fingerprint not found. A `CLOSED` unmerged PR does not count, so a finding abandoned that way resurfaces as `new`.

Suppress shipped and filed candidates from the actionable set but still count them in the digest tail.

## Digest

The only guaranteed output. Write `tmp/claude-discovery-digest-<YYYY-Www>.md`, ranked and grouped high to low confidence. Each entry shows the finding, its grounding note, the SQL that produced it, and its dedup status. Default `host=local` for config-change candidates. Cite imported hosts as corroborating counts only, never pasting raw `content`/`command`/`stdout` from an egress-blocked host (see host safety in `references/discovery.md`).

## File the Keepers

Present the actionable (new, grounded) candidates and ask the user which to file (numbers, ranges like `1-3`, or `all`), mirroring the triage UX in `SKILL.md`. For each selected candidate, create one Things todo via `things:url`, tagged `claude-code`:

- **Title**: `[discovery] <finding title>`
- **Notes**: the pitch, then the SQL/evidence, then `Discovery: <fingerprint>` on its own line.

Create one todo per candidate. Report how many todos landed. The main loop's triage, plan, implement, PR, CI, and annotate phases run on them later, unchanged.

## Direct Implementation

An opt-in alternative to filing, chosen explicitly by the user per run. Dispatch one background `general-purpose` agent with `isolation: "worktree"` for each grounded finding as soon as it lands, while the rest of the run continues. Each agent folds grounding in: it verifies the finding against the live config first, and if the config already addresses it, reports "not grounded" and changes nothing. Otherwise it implements, tests, runs `review:code`, and opens a PR via `pull-request:create`. Collect the PR links at the end.

These PRs have no backing Things todo, so skip the `Original Task` link. The body carries an Evidence section (local-host evidence only, never content from an egress-blocked host) plus one `Discovery: <fingerprint>` line per finding, which is what lets [Dedup](#dedup) suppress it instead of resurfacing it as `new`.

## Scheduled

`discover --scheduled` is the unattended weekly variant. It runs the same refresh, fan-out, grounding, dedup, and digest pipeline, then auto-files every candidate that is `new`, `grounded`, and `confidence == high`, using the exact format from [File the Keepers](#file-the-keepers). Medium and low confidence candidates land in the digest only. Dismissal is not tracked, so they resurface as `new` on the next run, where an interactive pass can file them.

A scheduled run never prompts, never implements ([Direct Implementation](#direct-implementation) is interactive-only), and ends after reporting how many todos it filed.

On-demand is primary. The weekly run is committed infrastructure: `user/scheduled/home/discover.yaml` declares `discover --scheduled` Mondays at 07:23, reconciled onto the always-on Mac Studio by `/scheduled sync` (see the `scheduled` skill). It must run locally because the session DB and the `duckdb` CLI live on that machine.

## Fingerprint

The dedup identity. Compute `sha256(finding_type + '|' + normalized_target)` truncated to 12 chars:

```bash
printf '%s' "hook-noop|team-workaround.ts" | shasum -a 256 | cut -c1-12
```

- `finding_type` is a stable slug for the class of finding (`hook-noop`, `permission-allowlist-miss`, `repeat-read`, `sandbox-deny`).
- `normalized_target` is the config object the finding is about (a hook script basename, a permission pattern, a skill name), never a count or a date, so re-runs of the same underlying finding collapse to one identity.

Filed todos carry `Discovery: <fingerprint>` in notes, and Direct-Implementation PRs carry it in the PR body. Suppressing dismissed findings (surfaced but not filed) is deferred: they reappear as `new` until filed.
