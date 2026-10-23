# Evals

Design eval suites, hill-climb a skill, agent, rule, or prompt against one, and review climbs for overfitting.

## Contents

- **Skills**:
  - `evals:hill-climb`: climbs a skill, agent, rule, or `CLAUDE.md` against its eval suite, with `references/suite.md` for readying the suite

## Evals

`evals/hill-climb` scores the climb's judgment steps (the Decide verdict and the error-analysis bucket) over frozen results. It is `.local-only`. Its README covers the loop.

## Tests

`bun test plugins/evals/evals/hill-climb` tests the case generators, and `bun evals/native/check.ts plugins/evals/evals/hill-climb` tests the regex graders against `examples/`.
