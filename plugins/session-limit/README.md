# Session Limit

Steer the model to wind down before a usage block runs out.

## Configuration

`overage` (default `false`): set it on accounts with extra usage so the exhausted-block message warns that further requests spend overage credits.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) reads the rate-limit windows on each `session.measure` and appends guidance mid-turn when a window crosses a band. Each append is logged through [`mod-events`](../mod-events/README.md) as an `inject` event, and a landed append prints a one-line summary to the transcript. Bands re-arm after `/clear` and `/resume`.
- **Bands**: [`bands.ts`](mod/bands.ts) holds the thresholds and their guidance. Each band fires once per block and re-arms when the window resets.
- **Types**: [`types/index.d.ts`](types/index.d.ts) declares the announced-band state.

## Tests

`bun scripts/mod-test.ts session-limit`
