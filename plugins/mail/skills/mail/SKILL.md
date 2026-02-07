---
name: mail
description: Reading and managing Apple Mail via JXA. Use when working with email, archiving messages, or processing the inbox.
---

# Mail

Apple Mail automation via JXA (`osascript -l JavaScript`).

## Archiving

Mail.app `delete()` moves messages to Trash, not Archive. There is no `archiveMailbox` property — find the archive mailbox by name per account.

See [archiving.md](archiving.md) for account detection, mailbox lookup, and batch archive patterns.

## Reading

```javascript
var app = Application("Mail");
var inbox = app.inbox();
var messages = inbox.messages();
```

Key properties: `subject()`, `sender()`, `dateReceived()`, `content()`, `mailbox().account()`.

## Notes

- JXA arrays from Mail may lack `.map()/.filter()` — use `Array.from()` or for-loops
- `.whose()` selectors fail on child mailbox arrays — use for-loops
- Launch Mail first if not running: `open -g -a "Mail"`
