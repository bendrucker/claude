# `git:conflicts` Autopilot on `wt sync` Restacks

Investigation into whether `wt sync` should automatically invoke the `git:conflicts` skill when a restack hits a conflict.

`tmp/` is gitignored in this repo, so this note lives at the repo root instead.

## Recommendation: NO-GO

Two independent reasons, either of which is sufficient:

1. There is no integration point. `wt sync` is an external binary with no per-rebase or post-conflict hook, and Worktrunk's hook lifecycle has no rebase or conflict event. A shell hook could not invoke an LLM skill anyway.
2. There is no demand for the safe slice. The conflicts actually resolved were semantic code merges during plain `git rebase origin/main`, not `wt sync`. Zero were mechanical lockfile conflicts. The lockfile-only slice that could be automated safely has no occurrences to automate.

## Conflict classification

Source: the DuckDB session index (`claude-code:session` skill) over `~/.claude/projects/`, refreshed 2026-06-19. The reproducible query is committed at `plugins/claude-code/skills/session/resources/queries/conflict-classification.sql`.

#### Skill invocations

| Skill | Invocations | Sessions |
| --- | --- | --- |
| `git:conflicts` | 57 | 55 |
| `git:fix-conflicts` (predecessor name) | 16 | 16 |
| Combined distinct sessions | | 56 |

The 57 `git:conflicts` invocations match the ~57 expected. Counting the predecessor name, 73 conflict-resolution invocations span 56 distinct sessions.

#### Context and mechanism

Run against the combined 56 sessions:

| Metric | Count |
| --- | --- |
| Total conflict-resolution sessions | 56 |
| Restack-context (rebase or `wt sync` run under the skill) | 17 |
| Used `wt sync` specifically | 1 |
| Mechanical lockfile conflicts | 0 |
| Restack and mechanical | 0 |

Restack-context counts sessions where a rebase or sync command ran under the skill's attribution. Broadening to any rebase command anywhere in the session raises it to ~21. Either way it is roughly a third of conflict sessions.

#### Why the conflicts were semantic

The files staged before `git rebase --continue` are the true conflicted set. Every one was application code or a test:

```
tools_duckdb_test.py, tools_test.py, tools_duckdb.py, conversion.py, settings.py,
settings_test.py, tracing.py, event_stream.py, references.py, duckdb.py,
report.ts, analyze.ts, tropes.ts, SKILL.md, test_collect.py, wsdl_schema.py
```

No lockfile appears in this set. The skill resolves a lockfile conflict by regenerating it (`bun install`), not by editing `bun.lock`, so the query keys off the staged-before-continue set rather than an Edit-on-lockfile signal. The single lockfile-related `git add` in the whole corpus was `git checkout -- bun.lock`, which discards an unwanted `bunx` change during a commit. The other "lockfile" command hits were `git status`, greps of `bun.lock`, and `bun install` verification runs.

The restack operation was almost always `git rebase origin/main` or `git rebase --onto`. `wt sync` itself appeared in only one conflict session, plus one separate `wt sync --dry-run` used to inspect a plan. `wt sync` essentially never produced the conflicts being resolved.

#### Reproducing the numbers

```bash
DB=$(/Users/ben/.claude/plugins/cache/bendrucker/claude-code/*/skills/session/scripts/refresh.ts --refresh)
duckdb -readonly "$DB" < plugins/claude-code/skills/session/resources/queries/conflict-classification.sql
```

The invocation counts come from the existing `skills` query:

```bash
duckdb -readonly "$DB" "SELECT skill_name, COUNT(*) invocations, COUNT(DISTINCT session_id) sessions
  FROM skill_calls WHERE skill_name IN ('git:conflicts','git:fix-conflicts') GROUP BY skill_name"
```

## Integration point

Confirmed against `wt`/`wt-sync` help output and the `worktrunk:worktrunk` skill reference files, not assumed.

#### `wt sync` is an external binary

`wt sync` resolves to `wt-sync` (`~/.cargo/bin/wt-sync`), the [`worktrunk-sync`](https://github.com/pablospe/worktrunk-sync) extension. Worktrunk runs any `wt-<name>` executable on `PATH` as a custom subcommand, the same way git runs `git-foo`. Custom subcommands are external binaries that Worktrunk shells out to. They sit outside its hook system.

`wt-sync --help` exposes only `-s/--stack`, `-a/--all`, `-f/--fetch`, `-p/--push`, `-P/--prune`, `-F/--force`, `-v/--verbose`, `-n/--dry-run`. There is no `--on-conflict`, hook, or wrapper flag. On a conflict it stops and leaves the rebase in progress for the caller to resolve.

#### Worktrunk has no rebase or conflict hook

`wt hook --help` lists every hook type:

```
pre/post-switch, pre/post-start, pre/post-commit, pre/post-merge, pre/post-remove
```

None fires per-rebase or on conflict. The merge hooks fire on `wt merge` (the squash-and-merge-to-main workflow), not on `wt sync` rebases. The repo's `.config/wt.toml` only sets `post-start = "bun install"`, consistent with there being no restack hook to configure.

#### A shell hook could not call the skill anyway

`git:conflicts` is a Claude Code skill. It runs inside a Claude session and is driven by the model. A shell-level hook fires a shell command and cannot summon an LLM to resolve a conflict. Automatic invocation only makes sense when Claude is already driving the restack, and in that case Claude can invoke the skill directly with no wiring. The Worktrunk alias recipe for bulk rebasing (`wt up`) reflects the tool's own stance: it auto-aborts on conflict (`git rebase ... || git rebase --abort`) rather than trying to resolve.

## If this is ever revisited

The narrowest defensible slice would be lockfile-only resolution during a restack, since that is mechanical and safe. The data shows that slice has zero occurrences, so it would automate a class of conflict that does not happen here. The real conflicts are semantic merges of code and tests, which need judgment and should stay interactive. Revisit only if `wt sync` adoption rises and lockfile conflicts start appearing in the staged-before-continue set.
