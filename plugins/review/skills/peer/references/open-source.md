# Open Source Review Context

## Disposition

- Default to request changes when code quality issues exist. Maintainers carry the long-term maintenance burden, so the bar is higher.
- Request changes for: code quality issues, missing tests, unclear naming, incomplete documentation, scope creep, and security concerns.
- Security is always blocking. Prefer mechanisms that make unsafe behavior impossible (data passed as data, not code) over detection-based approaches.

## What to Review

- Enforce minimal PR scope. Push back on unrelated changes (dependency bumps, formatting, contributor additions) that aren't part of the stated goal. Be persistent if they reappear after feedback.
- Focus on subjective qualities. When you spot something automatable (lint rule, CI check), file an issue to automate it and link it in the review comment rather than requesting the manual fix.

## How to Comment

- See [tone.md](../tone.md) for general comment style. Open-source additions: thank contributors for their work, then explain what needs to change and why.
- Scale teaching depth with contributor experience. Newer contributors benefit from enumerated edge cases, alternative approaches, and links to relevant documentation. Experienced contributors get terser feedback.
- Cite authoritative sources (official docs, upstream source code, specs) when requesting changes so contributors can verify the reasoning themselves.
