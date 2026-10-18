# Load

Guardrails against Claude-driven browsers and builds saturating the machine.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) gates `Bash` calls and closes an agent's browser sessions when it ends.
  - [`browser.ts`](mod/browser.ts) limits `agent-browser` to one session per agent and a few daemons machine-wide.
  - [`builds.ts`](mod/builds.ts) refuses heavy builds, test runners, and DuckDB started side by side, past a per-pool cap of running ones (2 builds and tests, 3 DuckDB), under critical memory pressure, or on a loaded machine. Under warning-level pressure each pool drops to one.
  - [`command.ts`](mod/command.ts) splits a command line into the simple commands both read.
- **Events**: launches, refusals, closes, and hook failures go to [`mod-events`](../mod-events/README.md) as `browser.*`, `build.*`, and `error`.

## Tests

`bun scripts/mod-test.ts load` runs the mod's tests.
