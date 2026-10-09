# Load

Guardrails against Claude-driven browsers and builds saturating the machine.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) gates `Bash` calls and closes an agent's browser sessions when it ends. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
  - [`browser.ts`](mod/browser.ts) limits `agent-browser` to one session per agent and a few daemons machine-wide.
  - [`builds.ts`](mod/builds.ts) refuses heavy builds and `pytest -n` started side by side, on top of running ones, or on a loaded machine.
  - [`command.ts`](mod/command.ts) splits a command line into the simple commands both read.
- **Events**: launches, refusals, closes, and hook failures go to [`mod-events`](../mod-events/README.md) as `browser.*`, `build.*`, and `error`.

## Tests

`bun scripts/mod-test.ts load` runs the mod's tests.
