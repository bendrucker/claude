# Open Source Review Context

## Disposition

- Default to request changes when code quality issues exist, because maintainers own the long-term maintenance.
- Request changes for code quality issues, missing tests, unclear naming, incomplete documentation, scope creep, and security concerns.
- Security is always blocking. Prefer mechanisms that make unsafe behavior impossible (data passed as data, not code) over detection.

## What to Review

- Enforce minimal PR scope. Push back on unrelated changes (dependency bumps, formatting, contributor additions), and again if they reappear after feedback (see [requirements.md](../requirements.md)).
- For anything automatable (lint rule, CI check), file an issue to automate it and link it in the comment instead of requesting the manual fix.

## Comments

- Thank contributors, then explain what needs to change and why (see [tone.md](../tone.md) for general style).
- Scale explanation depth with contributor experience. Give newer contributors enumerated edge cases, alternative approaches, and doc links. Give experienced contributors terser feedback.
- Cite authoritative sources (official docs, upstream source, specs) when requesting changes.
