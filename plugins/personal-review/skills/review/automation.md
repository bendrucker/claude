# Automation Extension Points

Future automation for common patterns.

## Auto-Handle Candidates

Patterns that could be handled without user input:

### GitHub

- **CI passed on my PR**: Mark done automatically
- **PR merged**: Mark done automatically
- **Stale subscription**: Auto-unsubscribe after N ignores
- **Read mentions**: Auto-mark done (already seen)
- **Already-reviewed PRs**: Auto-mark done when user has submitted a review

### Linear

- **Blocked issues**: Auto-defer to Things with blocker context
- **Stale in-progress**: Flag for review if no activity in N days

### Things

- **Repeating inbox items**: Auto-apply last decision
- **Project-hinted items**: Auto-assign to matching project

## Decision Logging

To enable automation, log decisions:

```json
{
  "source": "github",
  "identifier": "owner/repo#123",
  "reason": "REVIEW_REQUESTED",
  "action": "defer",
  "timestamp": "<ISO 8601>"
}
```

Pattern detection from logged decisions enables smart defaults.

## Not Yet Implemented

This file documents extension points. No automation is active yet. All items require user decision.
