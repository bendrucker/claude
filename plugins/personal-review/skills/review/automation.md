# Automation Extension Points

Future automation for common patterns.

## Auto-Handle Candidates

Patterns handleable without user input:

### GitHub

- **CI passed on my PR**: Mark done automatically
- **PR merged**: Mark done automatically
- **Stale subscription**: Auto-unsubscribe after N ignores
- **Read mentions**: Auto-mark done (already seen)
- **Already-reviewed PRs**: Auto-mark done when user has submitted a review

### GitLab

- **Build passed on my MR**: Mark todo done automatically
- **MR merged**: Mark todo done automatically

### Linear

- **Stale assignments**: Auto-defer to Things if unread for N days
- **Resolved status changes**: Auto-archive when issue is done/canceled

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

Pattern detection from logged decisions enables defaults.

## Not Yet Implemented

No automation is active yet. All items require user decision.
