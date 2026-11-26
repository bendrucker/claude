# Refactor

Behavior-preserving refactors, with the old behavior checked against the new code rather than assumed.

## Skills

- `port`: move code to a new implementation (another language, a framework's interface, a swapped engine) with a differential harness that treats the old code as the oracle.
- `split`: break a monolithic file, class, or function into modules while keeping its exported names and tests unchanged.
- `consolidate`: merge diverged copies of the same logic into one shared implementation, with each copy's drift surfaced for sign-off.
- `upstream`: replace homegrown code with the standard library or a maintained package, treating the library as the oracle.

## Evals

`bun evals/native/run.ts plugins/refactor/evals/refactor -- --tag dev` runs the suite. See [`evals/refactor/README.md`](evals/refactor/README.md).
