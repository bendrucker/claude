Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (my own repo)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Adds a new `friction` plugin: a skill with daily and weekly modes, a `ledger.ts` that stores fingerprinted findings and decides what to promote, SQL query files per source under `queries/<source>/`, a `collect.sh` that runs a source's queries, tests for the ledger and the queries, and a README. 26 files changed, +1310/-1.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- Goal: catch recurring setup friction. Mid-week, open a PR only for a blocker with a small fix. Everything else goes on a weekly list ranked by how many days it persisted.
- The model only emits fingerprinted findings. `ledger.ts` does the counting and the deciding, so promotion is deterministic and tested.
- One procedure, two windows. Both read osquery, Atuin, and the session index. Daily runs a short list of session-index queries (tool failures, hook blocks, sandbox bypasses, CLI health, no-op Stop hooks). `--window 7d` runs every query plus changelogs. `--day` replays a past day without delivering.
- Queries are SQL files taking the window as variables, and `collect.sh <source> <day> <days>` runs a source's queries in one call so the model never retypes SQL. `queries.test.ts` runs each over synthetic osquery snapshots and Atuin history.
- Daily opens at most one draft PR, for an entry seen today with impact high and a small fix. Weekly ranks open entries by days seen, then impact, and shows the top 5. Every run lists up to 5 near-misses, and `pick <fp>` opens a PR for one.
- Fingerprints stay stable because the run reads the ledger's open targets first and reuses them.
- Outcomes feed back: a dismissed entry stays quiet 30 days, a resolved entry that returns is flagged as a regression.
- Calibration: I labeled 10 real symptoms. Only `cloudsmith auth` (9 of 11 runs failed, high impact, small fix) should promote same-day. Commit signing refusals (112 across 61 sessions, not small), the 66 s Stop hook (moderate), sandbox bypasses at 8-11% of Bash calls, and the session-index refresh OOM (7 of 13) all go weekly. `ledger.test.ts` encodes the labeled set.
- A replay of Oct 18-20 kept the two 3-day entries (bun/duckdb overload, session-index refresh) below the cut as not small.
- Not done yet: no `7d` run has been executed, and scheduling either window is a follow-up. `proc_groups` stays empty until bendrucker/dotfiles#962 merges, so overload can't be attributed by process.
- `@duckdb/node-api` is a devDependency for the query tests only, with `omit=dev` so the plugin cache never installs it.
