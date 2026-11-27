# Refactor

Behavior-preserving refactors, with the old behavior checked against the new code rather than assumed.

## Skills

- `candidates`: survey a repository for refactoring targets (library replacements, splits, duplicate merges) and rank them with run-verified behavior differences, without changing code.
- `port`: move code to a new implementation (another language, a framework's interface, a swapped engine, a library replacing homegrown code, one version replacing duplicate copies) with a differential harness that treats the old code as the oracle.
- `split`: break a monolithic file, class, or function into modules while keeping its exported names and tests unchanged.

## Evals

`bun evals/native/run.ts plugins/refactor/evals/refactor -- --tag dev` runs the suite. See [`evals/refactor/README.md`](evals/refactor/README.md).
