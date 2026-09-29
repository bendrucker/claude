---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Adds a new github:stack skill documenting gh stack (the github/gh-stack extension) and wires stacked-PR awareness into babysit's merge mode, pull-request:create, ship, and user/CLAUDE.md, since gh pr merge does not work on a stacked PR and is the primary merge path in both. Covers detection via a GraphQL stack query, two tracking layouts chosen per stack, and merge/re-arm semantics under gh stack merge. 7 files changed, +167/-3.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
