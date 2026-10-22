Refine this into an issue:

We shipped link sharing but can't tell how shared links get used. Add product analytics events so we can measure how often people copy a link, and how often a shared item is opened from a list versus directly from a link.

Notes from reading the code:
- link_copied should fire after a successful clipboard write from either Copy link button: the share dialog footer (source "share_dialog") and the read-only viewer banner (source "viewer_banner"). It carries resource ("chat" or "document"), id, and source. copyLink returns nothing today; it should return whether the write succeeded so a failed copy doesn't emit the event.
- document_opened already exists with id and type. It keeps its name and those properties and adds access ("owner", "shared", or "org") and list ("mine" or "organization", from the organizationView prop on the grid).
- chat_opened is new. It fires when a chat card link is clicked, with id, access, and list. Clicks on the card's Share and Delete menu items don't fire it.
- A server-side chat_read or document_read counts as a direct-link visit when no chat_opened or document_opened for the same user and id precedes it within 5 minutes. Server read events carry no client session, so the join uses user, id, and time.

Files:
- components/share/ShareDialog.tsx (footer Copy link button calls copyLink)
- components/viewer/ReadOnlyBanner.tsx (banner Copy link button calls copyLink)
- lib/clipboard.ts (copyLink writes to the clipboard and swallows errors)
- components/document/list/Grid.tsx (emits document_opened on card click)
- components/chat/ChatCard.tsx (card link, plus a menu with Share and Delete)
- lib/events.ts (useEvents().track sends events to the analytics SDK)
