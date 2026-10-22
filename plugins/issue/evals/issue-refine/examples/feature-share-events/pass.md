---
fail: []
---
<issue>
---
title: Track link copies and how shared items get opened
type: feature
labels: [analytics, sharing]
---

We can't tell how shared links get used. Add events that count link copies and separate list opens from direct-link visits.

| Event | Fires when | Properties |
|---|---|---|
| `link_copied` | a Copy link write succeeds | resource, id, source |
| `document_opened` | a document card is clicked (existing) | adds access, list |
| `chat_opened` | a chat card link is clicked | id, access, list |

A server read counts as a direct-link visit when no open event for the same user and id precedes it within 5 minutes.

## 🤖 Agent Context

- `copyLink` in `lib/clipboard.ts` swallows errors; return whether the write succeeded
- `ChatCard` in `components/chat/ChatCard.tsx`: link only, not the Share and Delete menu items
</issue>
