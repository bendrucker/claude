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

Default to no comment. Write one only when:

- The code is dense (a regex, bit manipulation, a packed expression). Say in words what it does.
- The code is simple but its reason for existing is not obvious. Say why.

Delete a comment that says what simple code does. Keep a comment to one sentence. Keep a docstring to the function's contract in one line, with no callers, callees, or implementation. Express a data shape as a `TypedDict`, dataclass, or type alias instead of prose.

Leave out:

- Narration: migration stories, ticket breadcrumbs (`ENG-1234`), cross-references ("mirrors X", "at line 1208"), and arguments against approaches the code does not take.
- Self-praise: "never papered over", "can never escape".
- Section-divider banners and Title Case label comments.

Exceptions:

- A docstring may restate the identifier to spell out the canonical upstream API name it abbreviates.
- A regression test may state the bug it defends against: the ticket, the invariant, and the mechanism that broke it. Leave out the incident story.
- A guard or TODO may name the ticket that removes it: `# TODO(ENG-4102): drop once the backfill lands`.
