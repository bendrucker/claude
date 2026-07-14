# Requirement Fulfillment

Code quality and requirement fulfillment are separate axes. A well-written change can still implement the wrong thing, and a change that does the right thing can be sloppy about it. `/code-review` reviews the diff alone and cannot judge the change against the ticket. That judgment is the peer reviewer's. Evaluate it on its own so a polished diff never hides a requirement it missed.

## Locate the Spec

Find what the change is supposed to do, in order:

1. The linked issue or PRD and its acceptance criteria (`research.md` already fetches referenced issues and URLs, so reuse that context rather than fetching again)
2. The PR body's stated goal
3. Referenced design docs

If none exists, evaluate against the PR's own stated intent and note that no external spec was available.

## What to Check

- **Missing or partial requirements** - an acceptance criterion the change does not meet, or meets only for the common path.
- **Scope creep** - behavior beyond the stated goal (unrelated refactors, dependency bumps, formatting). See [open-source.md](references/open-source.md) for how hard to push back.
- **Questionable fulfillment** - a requirement met in letter but implemented in a way that is fragile or will not hold up as the feature grows.

## Disposition

This file covers what to check. Whether a gap blocks depends on context: [corporate.md](references/corporate.md) treats acceptance-criteria gaps as a blocking threshold, and [open-source.md](references/open-source.md) treats scope creep as grounds to request changes.
