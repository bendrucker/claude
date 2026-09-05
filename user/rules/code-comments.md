---
paths:
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.go"
  - "**/*.rs"
  - "**/*.sql"
  - "**/*.sh"
---

# Code Comments

A comment earns its place when it tells the reader something the adjacent code does not. Two shapes qualify:

- **What-on-dense**: the code is genuinely complex (a regex, bit-twiddling, a dense expression), so restate it in words.
- **Why-on-simple**: the code is simple but the reason it exists is non-obvious, so explain the reason.

Delete a **what-on-simple** comment, where the code is simple and the comment only says what it does.

Default to no comment. Most comments an agent writes fail the test above, and every one that survives review taxes each future reader. A comment that earns its place is one sentence carrying the fact. A docstring states the contract in one line. Typed signatures already document parameters and return values.

## Avoid

- **Restatement.** A comment paraphrasing the line below it: `# increment i` over `i += 1`.
- **Narration and decision log.** Migration stories repeated across helpers, ticket breadcrumbs (`ENG-1234`, "arrives with ENG-2065"), cross-references ("mirrors X", "at line 1208"), and arguments against an approach the code does not take. Comments document the code that exists, not the conversation that produced it.
- **Self-praise.** Virtue claims: "never papered over", "with no bespoke method", "can never escape".
- **Docstring scope creep.** A docstring documents the function's contract, not its callers, callees, or implementation. Use a `TypedDict`, dataclass, or type alias instead of describing a shape in prose.
- **Section-divider banners.** `# ---------` rules and `# Title Case Label` headers that organize code visually.

## Keep

- Genuine why and design rationale the code cannot express.
- Docstrings that surface canonical upstream API names for discoverability, even when they restate the identifier. `"""Return the Aembit OAuth 2.0 + PKCE authorization URL."""` introduces searchable proper nouns the name abbreviates.
- What-comments on genuinely dense lines.
- Verbose rationale in a regression test about the bug it defends against.
