# Session Limit

Steer the model to wind down before a usage block runs out and spills into overage.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) reads the rate-limit windows on each `session.measure` and appends guidance mid-turn when a window crosses a band. Each append is logged through [`mod-events`](../mod-events/README.md) as an `inject` event. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Bands**: [`bands.ts`](mod/bands.ts) holds the thresholds and their guidance. Each band fires once per block and re-arms when the window resets.
- **Types**: [`types/index.d.ts`](types/index.d.ts) declares the announced-band state.

## Tests

`bun scripts/mod-test.ts session-limit`
