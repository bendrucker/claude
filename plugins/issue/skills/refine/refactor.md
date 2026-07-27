# Refactor

## Sections

### Motivation

Why now. Pain points, what it unblocks, cost of inaction. Skip when title/summary convey why.

### Scope

What changes, what doesn't. State behavior changes explicitly (usually none).

### Approach

Strategy (incremental vs. big bang), key transformations, risks. Skip for single-file or atomic refactors; include when strategy, migration, or rollback matters. Don't enumerate thin, unevaluated options. State the chosen strategy, or the goal plus acceptance criteria.

### Validation

How to verify correctness. Test coverage, manual checks, metrics. Skip when the default test/lint/typecheck suite is the whole answer. Fold any added test into Scope.
