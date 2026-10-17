---
fail: []
---
<issue>
---
title: Pin conversations to the top of the sidebar
type: feature
---

Let users pin conversations so they sort above the recency-ordered list and stay pinned across sessions.

## Acceptance Criteria

- Pinned conversations render above unpinned ones in `ConversationList`
- `conversationStore` persists the pinned set across sessions
- The ordering lands in the single comparator from [the sidebar ordering rework](https://tracker.example.com/issue/TEAM-330)
</issue>
