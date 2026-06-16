# Corporate Review Context

## Disposition

- Default to approve. Most PRs from teammates should be approved, possibly with minor suggestions.
- Blocking threshold: production reliability (unbounded queries, new failure points for existing users), correctness bugs, security issues, or acceptance criteria gaps. Consider labeling critical comments as "Blocking" to signal severity.

## What to Review

- Verify the code delivers on the linked ticket's acceptance criteria, not just that it compiles and passes tests.
- Focus on subjective qualities: architecture decisions, naming, edge case reasoning, failure mode analysis. Anything detectable by a linter or static analysis should be automated instead of commented on. File an issue in the project tracker and link it (e.g., "This variable is unused. Issue for detecting this automatically: <link>").
- Code quality, type safety, PR body accuracy, and documentation gaps fall under a general quality umbrella. Flag them but they should not block unless they mask a correctness issue.

## How to Comment

- Use code snippets when they communicate the idea more clearly than prose. The goal is actionable advice, not a complete fix.
- See [tone.md](../tone.md) for general comment style. Corporate-specific additions: blocking comments should be matter-of-fact about the risk, non-blocking suggestions should be collaborative ("what about...", "have you considered...", "worth adding").
