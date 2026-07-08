# History-Discovery Recipe

Fan out read-only analysts over the session index to mine config-change candidates, ground every candidate against the live config, then emit a ranked digest. This is the engine `improve-claude-code`'s Discover mode drives; the recipe lives here so the per-run prompt stays small.

## Fan-Out

Mirror the "Parallel Queries (Workflows)" pattern in [`SKILL.md`](../SKILL.md): refresh once, then every agent opens the index read-only.

1. Refresh once, alone. `scripts/refresh.ts --refresh` takes an exclusive write lock, so it must finish before any agent starts. Capture the printed `$DB` path and hand it to the agents. Never let a fanned-out agent call `refresh.ts`.
2. Audit the instrument before trusting it: `duckdb -readonly "$DB" < resources/queries/index-health.sql`. Every alert constrains the run: a `stream-silent` kind means the dimensions reading it (e.g. diagnostics) return stale or empty results with no error; a stale host means cross-host numbers read that machine as idle; `null-timestamp-kinds` lists rows every date-scoped query excludes. Pass the alerts to the agents alongside `$DB`, and cite them in the digest wherever they cap a finding's confidence.
3. Fan out one agent per dimension below. Each runs its named queries (`duckdb -readonly "$DB" < resources/queries/<name>.sql`, scoped with `SET VARIABLE`) plus any inline rollups, all read-only, all against the one shared file. Read-only opens take no lock, so the agents never contend.
4. Each agent returns structured candidate findings plus the exact SQL it ran. The SQL travels with the finding so the grounding pass and the digest can both cite it.
5. One or more grounding agents re-check every candidate against the live config (see [Grounding](#grounding)). Drop or downgrade anything that does not hold.

## Dimension Cheat Sheet

Each dimension maps to the named queries that answer it (Tier-1 listed in [`catalog.md`](catalog.md), Tier-2 documented in [Tier-2 Catalog](#tier-2-catalog) below) plus the survey surfaces to start from. Simple `GROUP BY ... COUNT/SUM` rollups (tokens by host, turns by project, hook time by event) stay inline; an agent writes them in seconds.

| Dimension | Named queries | Survey surfaces |
|-----------|---------------|-----------------|
| Hook latency | `hook-origin-split` | `hooks` |
| Hook blocks | `hook-block-then-retry-success` | `hook-blocks`, `hooks` |
| Hook coverage | `hook-config-vs-observed` | `hooks` |
| Permissions and sandbox | `sandbox-bypass-effective-command`, `already-allowed-still-prompting`, `sandbox-path-deny-recurrence` | `permissions`, `sandbox` |
| Context tax | `catalog-reinjection-thrash-sessions` | `activity`, `hooks` (additionalContext) |
| Tokens | `repeat-read-waste`, `top-sessions-by-output` | `stats`, `model-summary`, `skill-activity` |
| Turns and compaction | `stop-hook-noop-detector` | `activity` (compactions, API errors) |
| Skill economy | `skill-auto-vs-explicit` | `skills`, `skill-activity` |
| Planning | `plans` | `plan_sessions`, `plan_calls` |
| Outcomes | `outcomes` | `pr_links`, `plan_calls`, `file_operations` |

Use `records`, `fields`, `schema`, and `keys` whenever a dimension needs a path that isn't pinned: `SELECT kind, COUNT(*) FROM records GROUP BY kind` is the full taxonomy, and `fields` infers the JSON keys under any path.

## Grounding

Grounding is required. Raw query findings can go stale if config changes.

Re-check every candidate against the live files under `/Users/ben/src/bendrucker/claude`. Drop the candidate if the config already addresses it; downgrade it if the evidence is thin or host-skewed. Carry two fields per candidate:

- `grounded` (boolean): the finding survived the re-check against live config.
- `confidence` (high/medium/low): how strong the grounded evidence is.

- Hooks run in parallel. Never sum hook durations as wall-clock; the cost the user waits on is the single slowest hook plus a fixed per-process overhead, not the sum across matching hooks. `hook-origin-split`'s `total_s` is aggregate process work, not latency.
- Split friction into the part a setting can change and the part it cannot. `ExitPlanMode` and `AskUserQuestion` rejections are not allowlistable; the named `permissions` and `errors` queries already exclude them, so only custom SQL over `permission_requests`/`tool_errors` needs that filter. Compound commands defeat `excludedCommands` prefix matching. Counting raw rejections without that split inflates the actionable set.
- A `disable-model-invocation: true` proposal is breaking if any other skill invokes the target via the `Skill` tool. The current binary blocks `Skill()` on a disabled skill even when the caller grants `Skill(<name>)` in its `allowed-tools`. Before grounding such a finding, grep `plugins` and `user` for `Skill(<name>)` and for the skill's name in other skills' bodies; a single cross-skill consumer fails it. Confirming only that the frontmatter key is absent is not enough.

Verify any claim about harness behavior against the primary Claude Code docs, not a paraphrase, before grounding a finding on it.

## Host Safety

The index spans every machine. `local` is this machine; imported hosts carry their own label and may be marked `block_egress` (see `SKILL.md` "Cross-Machine History").

- Aggregate across hosts, but label the host on every row. The queries here already select `host`.
- Default to `host = 'local'` for any config-change candidate. The config you are changing is this machine's. Use other hosts only as corroborating aggregate ("this also shows up on `work`"), never as the sole evidence for a local change.
- Never paste raw `content`, `command`, `stdout`, or `text` from an egress-blocked host verbatim into a digest, a todo, a PR, or anything else that leaves the machine. Quote `local` rows when you need a literal; cite imported hosts as counts only.

## Full Catalog

Additional queries available in `resources/queries/`:

- `hook-origin-split`: split hook wall-clock between portable shared config and per-repo project hooks. Measure your config, not someone's `make test-unit`.
- `already-allowed-still-prompting`: Bash prompts matching a `permissions.allow` pattern you pass as `allow_glob`. A non-empty result is an allowlist pattern mismatch, usually a compound command.
- `sandbox-path-deny-recurrence`: `Operation not permitted` Bash failures bucketed into concrete config gaps (worktree writes, tmux sockets, process substitution, mktemp, TLS, SSH agent), with recurrence and date span.
- `catalog-reinjection-thrash-sessions`: sessions re-injecting the full skill catalog and deferred-tools delta many times, with an estimated token total. The thrash detector. Tune via `min_injections`.
- `top-sessions-by-output`: sessions ranked by total output tokens, the runaway or unattended-session detector. Tune via `limit`.
- `stop-hook-noop-detector`: Stop hooks that never produce stdout, a decision, a block, or a non-zero exit. Pure-overhead removal candidates. Blocking errors carry no command and group under the bare hook event name; check the `blocks` column before calling anything overhead.
