---
fail: [para-words-60, links-source, body-words-80]
---
<issue>
---
title: Page stops responding after cancelling the viewer delete dialog
type: bug
---

Cancelling the delete dialog opened from the viewer's kebab menu leaves the page unclickable until reload. The menu and the dialog both set `pointer-events: none` on the body, and the dialog cleans up first, so the menu's cleanup restores the stale value and the body keeps blocking every click on the page. Render the dialog outside the menu so the menu unmounts first and the dialog's cleanup runs last. A Playwright spec cancels the dialog from the viewer kebab, then opens another document from the list, and it fails without the fix. Confirming the delete still works.
</issue>
