---
paths:
  - "**/*.md"
  - "**/*.mdx"
---

# Markdown

- Use a heading one level below its parent for a labeled subsection instead of a `**Label**:` line.
- Delete any section that exists only to fill a template.

## Docs

A doc states how things work now and the constraints a reader needs to change them safely. Leave out how they got that way: the motivating incident, what was investigated or tried, how a bug was found, rejected alternatives, what the thing replaced, and dates. That record belongs in the commit or PR. Keep a reason only when it stops a reader from breaking something, as one clause stating the constraint.

A document whose subject is a history, such as a changelog, postmortem, or findings report, is exempt.
