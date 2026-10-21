# Friction

Counts recurring friction across the development setup and surfaces a fix only for a symptom that keeps coming back.

## Before and After

Without it, a run over a day of telemetry reports everything it notices:

> Load spiked to 216 on Oct 18. DuckDB jobs were running during 60% of overload minutes. Each session-index refresh writes 6.6 to 28 GB. herdr uses 0.05 cores. Consider reviewing your background processes.

With it, the same day's run reads the ledger first, so it acts on the one symptom that persisted and has a small fix:

> Opened a draft PR adding a 10 s per-name thread snapshot to `osquery.conf` (`Friction: 7cb7391c9fcf`): overload without a tracked cause on 3 of the last 3 days.
>
> **Below the cut**
> - `a41f…` session-index DuckDB jobs, 3 days: 60% of load>30 minutes vs 4% quiet. Rebuild views per touched session.
> - `9e02…` session-index refresh, 2 days: 6.6 to 28 GB written. Same fix.

A day where nothing persisted produces one line.

## Contents

- **Skill `friction`**: the daily (`--window 1d`) and weekly (`--window 7d`) run, and `pick <fingerprint>` for a below-the-cut item.
  - [`ledger.ts`](skills/friction/scripts/ledger.ts) records findings, counts distinct days per fingerprint, and decides what surfaces.
  - [`osquery.md`](skills/friction/references/osquery.md) and [`atuin.md`](skills/friction/references/atuin.md) hold the named queries over each source.

The ledger lives at `$XDG_STATE_HOME/friction/ledger.jsonl`, or `FRICTION_LEDGER`.

## Tests

`bun test plugins/friction` runs the ledger tests, which encode the Studio reference set from Oct 18 to 20.
