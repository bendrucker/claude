# History-Discovery Recipe

Fan out read-only analysts over the session index to mine config-change candidates, ground every candidate against the live config, then emit a ranked digest. This is the engine `improve-claude-code`'s Discover mode drives; the recipe lives here so the per-run prompt stays small.

## Fan-Out

Mirror the "Parallel Queries (Workflows)" pattern in [`SKILL.md`](../SKILL.md): refresh once, then every agent opens the index read-only.

1. Refresh once, alone. `scripts/refresh.ts --refresh` opens the database read-write, which needs exclusive access, so it must finish before any agent starts. Never let a fanned-out agent call `refresh.ts`. The DB path is stable (stated in `SKILL.md`), so agent prompts reference it directly.
2. Audit the instrument before trusting it: `duckdb -readonly <db-path> < resources/queries/index-health.sql`. Every alert constrains the run: a `stream-silent` kind means the dimensions reading it (e.g. diagnostics) return stale or empty results with no error; a `stream-migrated` kind is still live under the successor field its detail names, so read that field instead of treating the kind's zero as an absence; a stale host means cross-host numbers read that machine as idle; `null-timestamp-kinds` lists rows every date-scoped query excludes. Pass the alerts to the agents, and cite them in the digest wherever they cap a finding's confidence.
3. Occasionally, not every run: `field-drift` reports fields the harness started writing on record kinds the index already carried, which is the drift `index-health` structurally cannot see. It takes tens of seconds against `index-health`'s six, and its output moves on the scale of weeks. A hit means a query somewhere is inferring what the harness now states, so read it as a backlog item rather than as a constraint on the current run.
4. Fan out one agent per dimension below, each with `subagent_type: analyst`. Every dimension reads the index and reports, which is what that agent is for, and it carries its own Sonnet default so the fan-out does not bill at an Opus orchestrator's rate. Each runs its named queries (`duckdb -readonly <db-path> < resources/queries/<name>.sql`, scoped with `SET VARIABLE`) plus any inline rollups, all read-only, all against the one shared file. Read-only opens share the lock, so the agents never contend with each other.
5. Each agent returns structured candidate findings plus the exact SQL it ran. The SQL travels with the finding so the grounding pass and the digest can both cite it.
6. One or more grounding agents re-check every candidate against the live config (see [Grounding](#grounding)). Drop or downgrade anything that does not hold. Grounding needs `WebFetch` to check harness claims against the primary docs, which `analyst` has no access to, so leave these agents generic and pass them a cheap `model`.

## Dimension Cheat Sheet

Each dimension maps to the named queries that answer it, all documented in [`catalog.md`](catalog.md), plus the survey surfaces to start from. Simple `GROUP BY ... COUNT/SUM` rollups (tokens by host, turns by project, hook time by event) stay inline. An agent writes them in seconds.

This table and the Tier-2 list below are generated from the `-- ---` headers on `resources/queries/*.sql`. Edit the header, then regenerate with `UPDATE_QUERY_CATALOG=1 bun test plugins/claude-code/skills/session`.

<!-- generated:dimensions -->
| Dimension | Named queries | Survey surfaces |
|-----------|---------------|-----------------|
| Hook latency | `hook-origin-split` | `hooks` |
| Hook blocks | `hook-block-then-retry-success` | `hook-blocks`, `hooks` |
| Hook coverage | `hook-config-vs-observed` | `hooks` |
| Permissions and sandbox | `already-allowed-still-prompting`, `sandbox-bypass-effective-command`, `sandbox-path-deny-recurrence` | `permissions`, `sandbox` |
| Context tax | `catalog-reinjection-thrash-sessions` | `activity`, `hooks` (additionalContext) |
| Tokens | `delegation`, `repeat-read-waste`, `top-sessions` | `stats`, `model-summary`, `skill-activity` |
| Turns and compaction | `stop-hook-noop-detector` | `activity` (compactions, API errors) |
| Skill economy | `skill-auto-vs-explicit` | `skills`, `skill-activity` |
| Planning | `plans` | `plan_sessions`, `plan_calls` |
| Outcomes | `outcomes` | `pr_links`, `plan_calls`, `file_operations` |
<!-- /generated:dimensions -->

Use `records`, `fields`, `schema`, and `keys` whenever a dimension needs a path that isn't pinned: `SELECT kind, COUNT(*) FROM records GROUP BY kind` is the full taxonomy, and `fields` infers the JSON keys under any path.

## Grounding

Grounding is required. Raw query findings can go stale if config changes.

Re-check every candidate against the live files under `/Users/ben/src/bendrucker/claude`. Drop the candidate if the config already addresses it; downgrade it if the evidence is thin or host-skewed. Carry two fields per candidate:

- `grounded` (boolean): the finding survived the re-check against live config.
- `confidence` (high/medium/low): how strong the grounded evidence is.

- Hooks run in parallel. Never sum hook durations as wall-clock; the cost the user waits on is the single slowest hook plus a fixed per-process overhead, not the sum across matching hooks. `hook-origin-split`'s `total_s` is aggregate process work, not latency.
- `hook_events` never records a PreToolUse deny, so the `blocks` and `friction_pct` columns in `hooks` understate a denying hook, often to zero. Read `hook-blocks` (which unions the recovered `hook_denies` rows) before calling a hook low-friction, and check `index-health`'s `hook-deny-invisible` for how much of the deny channel is dark in the window you are mining.
- A subagent's transcript lines carry the PARENT session's id, so `session_id` alone cannot separate a parent's own tool calls from its fan-out's. `hook_denies` is where this bites hardest, because a recovered deny comes from a tool_result and subagents produce those in volume: a discovery run's own mining subagents each hitting a hook once reads as one enormous burst by the orchestrator. Key any per-session claim over `tool_calls`, `tool_errors`, or `hook_denies` on `agent_id` as well (`hook-blocks` does), and read `subagent_blocks` before calling a hook a storm.
- An aggregate spanning a fix reports a closed bug as current. Before citing a block or deny count, compare the signature's `first_seen`/`last_seen` against the git history of the hook that produced it: a count that stops at the commit that fixed the hook is evidence the fix worked, not evidence of friction. Split the window at that commit and re-run rather than reporting the total.
- Explicitness of a skill invocation does not live on the Skill call. Typing `/name` expands into a user message carrying a `<command-name>` marker, and args on a Skill call are ordinary model routing. `skill-auto-vs-explicit` splits those two populations, and a `disable-model-invocation` finding rests on its `explicit` column.
- A hook's `p95_ms` is not attributable until `excess_p95_ms` confirms it. Host-wide slowdowns inflate every hook in the same hour by the same factor, `bash` and `bun` alike, so the highest-volume hooks sample those windows most and look slow. Check `ambient_p50_ms` before filing a latency finding. Where a hook self-times its own work (the `writing` PreToolUse dispatcher writes `duration_ms` to `~/.claude/writing-hooks/log.jsonl`), that in-process figure beats the harness duration, which includes process spawn and interpreter start.
- Split attachment and injection counts by `isSidechain` before making any per-session claim about them. Per-subagent context (the skill catalog, the deferred-tools delta) is injected once per subagent, so a session total scales with fan-out and any co-scaling variable will look causal.
- Catalog and deferred-tools reinjection volume is not itself a finding. The harness controls when it reinjects, and no config change here reduces it. Injections fire on resume as well as at a `system:compact_boundary`, which is why a window's total runs large even when actual compaction is rare. Use the volume as an input to valuing catalog and skill-description tokens, since those pay repeatedly per session rather than once, and stop there rather than filing it as a candidate.
- Split friction into the part a setting can change and the part it cannot. `ExitPlanMode` and `AskUserQuestion` rejections are not allowlistable; the named `permissions` and `errors` queries already exclude them, so only custom SQL over `permission_requests`/`tool_errors` needs that filter. Compound commands defeat `excludedCommands` prefix matching. Counting raw rejections without that split inflates the actionable set.
- A `disable-model-invocation: true` proposal is breaking if any other skill invokes the target via the `Skill` tool. The current binary blocks `Skill()` on a disabled skill even when the caller grants `Skill(<name>)` in its `allowed-tools`. Before grounding such a finding, grep `plugins` and `user` for `Skill(<name>)` and for the skill's name in other skills' bodies; a single cross-skill consumer fails it. Confirming only that the frontmatter key is absent is not enough.

Verify any claim about harness behavior against the primary Claude Code docs, not a paraphrase, before grounding a finding on it.

## Host Safety

The index spans every machine. `local` is this machine; imported hosts carry their own label and may be marked `block_egress` (see `SKILL.md` "Cross-Machine History").

- Aggregate across hosts, but label the host on every row. The queries here already select `host`.
- Default to `host = 'local'` for any config-change candidate. The config you are changing is this machine's. Use other hosts only as corroborating aggregate ("this also shows up on `work`"), never as the sole evidence for a local change.
- Never paste raw `content`, `command`, `stdout`, or `text` from an egress-blocked host verbatim into a digest, a todo, a PR, or anything else that leaves the machine. Quote `local` rows when you need a literal; cite imported hosts as counts only.

## Tier-2 Catalog

Additional queries in `resources/queries/`, aimed at the self-improvement loop rather than everyday analysis. Parameters and caveats for each are in [`catalog.md`](catalog.md).

<!-- generated:tier-2 -->
- `already-allowed-still-prompting`: Bash permission prompts whose command matches a `permissions.allow` pattern you pass as `allow_glob`.
- `catalog-reinjection-thrash-sessions`: Sessions re-injecting the full skill catalog and deferred-tools delta, cumulatively re-billing the same context.
- `hook-origin-split`: Hook wall-clock split between portable shared config and arbitrary per-repo project hooks.
- `hook-self-timing`: Hook latency from the hooks' own clocks, read off `~/.claude/hook-metrics/*.jsonl` rather than the index.
- `sandbox-path-deny-recurrence`: `Operation not permitted` and adjacent Bash failures bucketed into concrete sandbox config gaps, with recurrence and date span.
- `stop-hook-noop-detector`: Stop hooks that cost wall-clock and produce nothing, ranked as removal candidates.
<!-- /generated:tier-2 -->
