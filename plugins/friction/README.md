# Friction

Counts recurring friction across the development setup. Mid-week it opens a PR only for a blocker with a small fix. Everything else goes to a weekly list, ranked by how many days it persisted.

## Before and After

Without it, a run over a day of telemetry reports everything it notices (sketched from the Oct 20 data):

> Load spiked to 67 on Oct 20. DuckDB jobs were running during 67% of overload minutes. Session-index refreshes wrote 70 GB. `cloudsmith auth` failed 9 of 11 times. herdr uses 0.05 cores. Consider reviewing your background processes.

With it, the same day's run reads the ledger first, opens a PR only for the blocker, and lists the rest:

> Opened a draft PR fixing `cloudsmith auth` (`Friction: 51330ae96d0e`): 9 of 11 runs failed across 25 minutes of retries.
>
> **Below the cut**
> - `363d8b49f935` `bun, duckdb`, 3 days: 67% of load>30 minutes vs 7% quiet. Make the scheduled job incremental.
> - `8bb15044b0cc` session-index refresh, 3 days: 70 GB written. Rebuild views per changed session.

A day with no blocker produces one line.

## Requirements

- osqueryd configured by the dotfiles `osquery` topic, and Atuin
- `duckdb` and `bun` on `PATH`
- `~/.local/state/friction` in the sandbox `allowWrite`, which `user/settings.json` sets
- For the tests only, `@duckdb/node-api`, a devDependency the plugin cache omits

## Contents

- **Skill `friction`**: the daily (`--window 1d`) and weekly (`--window 7d`) run, and `pick <fingerprint>` for a below-the-cut item.
  - [`ledger.ts`](skills/friction/scripts/ledger.ts) records findings, counts distinct days per fingerprint, and decides what surfaces.
  - [`queries/`](skills/friction/queries/) holds each source's loader and named queries, and [`collect.sh`](skills/friction/scripts/collect.sh) runs them over a window in one call.
  - [`osquery.md`](skills/friction/references/osquery.md) and [`atuin.md`](skills/friction/references/atuin.md) say how to read each query and name its target.

The ledger lives at `$XDG_STATE_HOME/friction/ledger.jsonl`, or `FRICTION_LEDGER`.

## Tests

`bun test plugins/friction` runs the ledger tests, which encode the calibration labels, and the query tests, which run each named query over synthetic osquery snapshots and Atuin history and check its rows.
