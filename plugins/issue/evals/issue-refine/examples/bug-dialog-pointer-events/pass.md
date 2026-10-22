---
fail: []
---
<issue>
---
title: Page stops responding after cancelling the viewer delete dialog
type: bug
---

Cancelling the delete dialog opened from the viewer's kebab menu leaves the page unclickable until reload. The menu and the dialog both set `pointer-events: none` on the body, and the dialog cleans up first. Render the dialog outside the menu.

A Playwright spec cancels the dialog from the viewer kebab, then opens another document from the list.

## 🤖 Agent Context

- `ViewerMenu` in `components/viewer/ViewerMenu.tsx` renders `DeleteDialog` inside the menu content
</issue>
