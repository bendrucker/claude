# Evals

Hill-climb a skill, agent, rule, or prompt against its eval suite, and review a climb's claimed gain.

## Contents

- **Skills**:
  - `evals:hill-climb`: climbs a skill, agent, rule, or `CLAUDE.md` against its eval suite, with references for readying the suite, the native commands, the climb log, and an adapter for any other harness
- **Agents**:
  - `evals:review`: reviews a climb or eval-backed PR/MR cold and reports whether its claimed gain holds

## Evals

`evals/hill-climb` scores the climb's judgment steps (the Decide verdict and the error-analysis bucket) over frozen results. It is `.local-only`. Its README covers the loop.

`evals/review` hands a session a frozen climb PR, with one flaw planted or a real flawed PR, and grades its verdict and whether it names the flaw. It is `.local-only`.

## Tests

`bun test plugins/evals/evals/hill-climb plugins/evals/evals/review` tests the case generators, and `bun evals/native/check.ts plugins/evals/evals/<suite>` tests the regex graders against `examples/`.
