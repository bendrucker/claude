# Corporate Review Context

## Disposition

- Default to approve, possibly with minor suggestions.
- Block on production reliability (unbounded queries, new failure points for existing users), correctness bugs, security issues, or acceptance-criteria gaps. Label those comments "Blocking".

## What to Review

- Check the code against the linked ticket's acceptance criteria (see [requirements.md](../requirements.md)).
- Comment on architecture, naming, edge-case reasoning, and failure modes. For anything a linter or static analysis could catch, file an issue in the project tracker and link it (e.g., "This variable is unused. Issue for detecting this automatically: <link>").
- Flag code quality, type safety, PR body accuracy, and documentation gaps as non-blocking unless they mask a correctness issue.

## Comments

- Use code snippets when they communicate the idea more clearly than prose. Aim for actionable advice rather than a complete fix.
- See [tone.md](../tone.md) for blocking vs non-blocking phrasing.
