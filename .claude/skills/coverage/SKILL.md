---
name: coverage
description: Measure Bun test coverage and close gaps on a specific file. Use when adding or editing tests, when asked about coverage, or when the PostToolUse coverage hook reports uncovered lines.
allowed-tools:
  - Read
  - Edit
  - Bash(bun *scripts/coverage*)
  - Bash(bun test:*)
---

# Coverage

Measure which lines of a source file your tests exercise, then close the gaps. The engine is Bun's built-in coverage (`bun test --coverage`); `scripts/coverage/` resolves the test scope, runs it, and reports the uncovered lines.

## Loop

Work one source file at a time:

1. **Measure.** Run coverage scoped to the file:

   ```bash
   bun scripts/coverage/index.ts <file>
   ```

   It runs the tests in the file's scope (its plugin, package, `.claude`, or `user` root) and prints a table plus the exact uncovered line numbers.

2. **Read.** Open the file at those line numbers. Each uncovered line is a branch, error path, or case no test reaches.

3. **Add tests.** Write or extend tests that drive execution through those lines. Target the specific uncovered behavior each line represents.

4. **Re-measure.** Run the same command. Confirm the uncovered list shrinks toward empty. Repeat until the lines you care about are covered.

## Notes

- Pass multiple files to measure them together; the command merges their scopes.
- Each run rewrites `coverage/lcov.info`, which the PostToolUse hook reads to flag uncovered lines after later edits. If the hook reports stale data, just re-run the command.
- Coverage is opt-in. Plain `bun test` does not measure it, so normal test runs stay fast.
- Pursue meaningful coverage. A line that only runs in an environment the tests can't reproduce is a worse target than a real untested branch.
