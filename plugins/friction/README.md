# Friction

Counts recurring friction across the development setup. Mid-week it opens a PR only for a blocker with a small fix. Everything else goes to a weekly list, ranked by how many days it persisted.

> Opened a draft PR fixing `cloudsmith auth` (`Friction: 51330ae96d0e`): 9 of 11 runs failed across 25 minutes of retries.
>
> **Below the cut**
> - `363d8b49f935` `bun, duckdb`, 3 days: 67% of load>30 minutes vs 7% quiet. Make the scheduled job incremental.
> - `8bb15044b0cc` session-index refresh, 3 days: 70 GB written. Rebuild views per changed session.

## Requirements

- osqueryd logging the snapshots [osquery.md](skills/friction/references/osquery.md) lists, and Atuin
- `duckdb` and `bun` on `PATH`
- `~/.local/state/friction` in the sandbox `allowWrite`, which `user/settings.json` sets

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `config_repos` | none | Local clones holding the setup's config. Findings are checked against them, and fixes open there |
| `osquery_dir` | `~/.local/state/osquery` | Where osqueryd writes its snapshot log |
| `atuin_db` | `~/.local/share/atuin/history.db` | Atuin's history database |

## Contents

- **Skill `friction`**: the daily (`--window 1d`) and weekly (`--window 7d`) run, and `pick <fingerprint>` for a below-the-cut item

The ledger lives at `$XDG_STATE_HOME/friction/ledger.jsonl`, or `FRICTION_LEDGER`.

## Tests

`bun test plugins/friction` runs the ledger tests, which encode the calibration labels, and the query tests, which run each named query over synthetic osquery snapshots and Atuin history and check its rows.
