---
name: friction
disable-model-invocation: true
description: Find persistent friction in the development setup (contention, slow or failing commands, tool gaps) from machine telemetry, count each symptom across days in a ledger, and surface only small fixes for symptoms that keep recurring. Use for the scheduled daily or weekly friction run, or to pick an item from a run's below-the-cut list.
argument-hint: "[--window 1d|7d] [--day YYYY-MM-DD] [pick <fingerprint>]"
allowed-tools:
  - Bash
  - Read
  - Skill(observability:session)
  - Skill(pull-request:create)
---

# Friction

Find what keeps slowing the setup down. Every symptom here recurs. Mid-week, only a blocker with a small fix is worth a change. Everything else waits for the weekly list, ranked by how many days it persisted.

The output budget is the point of this skill. A run that surfaces nothing is a correct run. Never pad.

## Arguments

- `--window 1d` (default): the daily run. Last 24 hours of osquery, Atuin, and the session index, about 5 minutes, offline. Reading the session index runs its incremental refresh first, so schedule the run after the day's other refreshes.
- `--window 7d`: the weekly run. Last 7 days of the same sources, plus upstream changelogs, 20 to 30 minutes.
- `--day YYYY-MM-DD`: run as of a past day, to backfill the ledger or replay a calibration day. Bound every query to the window ending that day, pass `--day` to every ledger command, and print the decision without delivering it.
- `pick <fingerprint>`: the user asked for a below-the-cut item. Run `scripts/ledger.ts outcome <fingerprint> picked`, then open its draft PR as daily promotion does in [Deliver](#5-deliver), which records it `filed`.

The window sets lookback, sources, and budget. The steps and the ledger rules are identical for both.

## Steps

### 0. Outcomes

Check the open `Friction:` PRs and record any outcome the ledger lacks (see [Outcomes](#outcomes)). A `--day` replay skips this step.

### 1. Collect

Run named queries over the window. Each source returns rows, not prose. For osquery and Atuin, run the source's queries in one call, with the run's day and the window length in days (1 or 7). Never retype the SQL.

```bash
FRICTION_OSQUERY_DIR="${user_config.osquery_dir}" "${CLAUDE_SKILL_DIR}/scripts/collect.sh" osquery 2026-10-20 1
FRICTION_ATUIN_DB="${user_config.atuin_db}" "${CLAUDE_SKILL_DIR}/scripts/collect.sh" atuin 2026-10-20 1
```

| Source | Window | How |
| --- | --- | --- |
| osquery | both | `collect.sh osquery`. How to read each query and name its target: [references/osquery.md](references/osquery.md) |
| Atuin | both | `collect.sh atuin`: slow and failing command heads. [references/atuin.md](references/atuin.md) |
| Session index | both | `observability:session` named queries with `after_date` at the window start. Daily: `tool-failure-rates`, `hook-blocks`, `hook-block-then-retry-success`, `sandbox-bypass-scaffold`, `cli-health`, `stop-hook-noop-detector`. Weekly runs every named query. It sees only local transcripts, so a quiet index means work moved to cloud sessions, not that friction stopped |
| Changelogs | `7d` | Release notes since the last run for tools the config repos install that the window's data shows in use |

Normalize every metric to a rate: per active hour, per call, or a share of minutes. Activity swings 200x day to day, so a raw count compares nothing.

### 2. Ground

Check each candidate against the live config in the config repos (`${user_config.config_repos}`), or the config files the tool reads when none are set. Drop any the config already addresses. A fix that does less work (skip a job, lower a limit) is not a fix here. Look for the change that makes the same work faster or attributes it.

### 3. Emit Findings

First read the open targets, so a symptom seen before keeps its fingerprint:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/ledger.ts" status
```

Reuse an entry's exact `type` and `target` when it describes the same symptom, even when you would word it differently. Otherwise take the target from the query's row in [osquery.md](references/osquery.md#targets) or [atuin.md](references/atuin.md#targets). For a session-index finding, the target is the hook script, tool, or command head the query names.

One JSON object per symptom seen in the window, including ones you expect to stay quiet:

```json
{"type": "contention", "target": "bun, duckdb", "impact": "high",
 "metric": "60% of saturated minutes had a bun/duckdb job within 2 min, vs 4% of other minutes",
 "fix": "rebuild session-index views per touched session", "small": false}
```

- `type`: `contention`, `slow-command`, `failing-command`, `tool-gap`, `upstream-change`, `config-drift`.
- `target`: the object the symptom is about, named the same way every run: a process name, a command head (its first two words, `g pull`, never its arguments), a tool, a hook script. The fingerprint is `type|target`, so a renamed target restarts its count.
- `impact`: decides what surfaces, so grade it by what the symptom costs the user, not by how often it fires.
  - `high`: blocks work. A command keeps failing through retries until someone works around it, or work stalls for minutes. Example: an auth command failing 9 of 11 runs across 25 minutes of retries.
  - `moderate`: costs time or attention, but work recovers on its own. Examples: a hook rejection that costs Claude one retry turn, a minute added to each turn, commit signing failures that a retry clears.
  - `low`: measurable but unnoticed. Low never surfaces. Record it so growth shows.

  Skip a guard firing as designed (a write-block hook stopping a write it should stop). It is not friction.
- `metric`: the one number behind the finding, with its query named.
- `small`: true only when the fix is one PR of a handful of lines in one topic, with no new dependency, and reverts cleanly.

Never put command arguments, paths under a work directory, or file contents in a finding. The ledger may leave the machine.

### 4. Record

Pipe the array to the ledger. It appends the day's findings, counts distinct days per fingerprint, and prints the decision:

```bash
echo "$FINDINGS" | bun "${CLAUDE_SKILL_DIR}/scripts/ledger.ts" record --window 1d
```

Do not count, rank, or override the decision yourself. The rules it applies:

- Daily: promotes at most one entry seen today with `impact: high` and `small: true`. Moderate never promotes mid-week, however often it recurs.
- Weekly: ranks every open entry by days seen, then impact, and promotes the top 5.
- Filed and picked fingerprints wait for their outcome. Dismissed ones stay quiet for 30 days. A resolved one that returns is flagged `regression`.

### 5. Deliver

Daily, when `promote` holds an entry: implement the fix in the config repo that owns it and open a draft PR through `pull-request:create`, with `Friction: <fp>` on its own line in the body and the metric as evidence. Then record it:

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/ledger.ts" outcome <fp> filed --ref <pr-url>
```

Weekly: write one ranked list, highest first. Each entry gives the target, days seen, the metric, the proposed change, and whether it is small.

Both windows end the run's output with **Below the cut**: each `belowCut` entry as one line with its fingerprint, days seen, metric, and proposed change. The user picks from it with `pick <fingerprint>`. When the decision is empty, the whole output is one line saying the run found nothing to surface, plus how close the contention checks came: `saturation`'s `min_idle_pct` and the top `write-rate` name with its `peak_gb_per_min`.

## Outcomes

When a `Friction:` PR merges, record `resolved`. When the user closes one unmerged, record `dismissed`.
