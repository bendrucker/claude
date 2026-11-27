---
type: regex
pattern: '^ci: pass$'
flags: m
weight: 2
target: { source: file, path: .git/eval/verdicts }
---
Every step `.github/workflows/ci.yml` runs passes on the final tree: lint, the tests, `scripts/check-stdout.ts`, and `bun run build`. On a natural port, lint, `bun run typecheck`, and `bun test` all pass, while the build's `tsconfig.build.json` (`exactOptionalPropertyTypes` rejects passing the `flags()` record straight to `formatTotal`) and the stdout check (output above `if (import.meta.main)` in a `src/` module) fail. Only the workflow file runs those two.
