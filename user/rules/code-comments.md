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

A comment earns its place only when it adds information not readily available in
the code. Two shapes qualify:

- **What-on-dense**: the code is genuinely complex (a regex, bit-twiddling, a
  dense expression), so restate it in words.
- **Why-on-simple**: the code is simple but the reason it exists is non-obvious,
  so explain the reason.

A **what-on-simple** comment is the core slop case. If the code is simple and the
comment only says what it does, delete the comment.

This is not "no comments." Good comments are worth writing. The bar is whether
the comment tells the reader something the adjacent code does not.

## Avoid

- **Restatement.** A comment that paraphrases the line below it. `# increment i`
  over `i += 1`.
- **Narration / decision log.** The diary of how the change came to be: migration
  stories repeated across helpers, ticket breadcrumbs (`ENG-1234`, "arrives with
  ENG-2065"), cross-references ("mirrors X", "matches the other place", "at line
  1208"), and arguments against an approach the code does not take. Comments
  document the code that exists, not the conversation that produced it.
- **Self-praise.** Virtue claims about the code: "never papered over", "with no
  bespoke method", "can never escape".
- **Docstring scope creep.** A docstring documents the function's contract, not
  its callers, callees, or implementation. Do not use prose where a type belongs:
  use a `TypedDict`, dataclass, or type alias instead of describing the shape in
  words.
- **Section-divider banners.** `# ---------` rules and `# Title Case Label`
  headers that organize code visually instead of adding information.

## Keep

- Genuine why and design rationale the code cannot express.
- Docstrings that surface canonical upstream API names for discoverability, even
  when they restate the identifier: `"""Return the Aembit OAuth 2.0 + PKCE
  authorization URL."""` introduces searchable proper nouns the name abbreviates.
- What-comments on genuinely dense lines.
- Verbose rationale in a regression test about the bug it defends against.
