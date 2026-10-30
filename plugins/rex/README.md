# Rex

Conventions for driving the Rex terminal multiplexer from a session running inside it. Rex's native `rex` skill covers general mechanics.

## Contents

- **Skill**: [`rex`](skills/rex) holds the split, viewing, long-running-process, host, and peer conventions, and injects a compact view of the session's tabs and panes

## Observability

Keep the skill while it is used and the native guide is not re-probed. Trim or remove it when either signal shows it is a no-op.

- Re-probes: the count of `rex __internal skill` and `rex <cmd> --help` calls in Rex sessions, queried through `observability:session`. A high count means the skill leaves mechanics unanswered.
- Dispatch use: ledger rows with `mux=rex` from [`dispatch`](../dispatch). Rows that never appear mean Rex hand-offs bypass the convention.

## Tests

`bun test plugins/rex` runs the orientation script's tests.
