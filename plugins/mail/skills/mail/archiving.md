# Archiving

**Never use `delete()`** — it moves to Trash on all account types. Use `move()` to the correct mailbox.

## Account Detection

```javascript
var account = msg.mailbox().account();
var serverName = account.serverName();  // e.g., "imap.gmail.com"
var accountType = account.accountType(); // e.g., "imap", "iCloud"
```

## Finding the Archive Mailbox

| Account | Server Name | Target Mailbox |
|---------|------------|----------------|
| Gmail | contains `gmail.com` | `[Gmail]/All Mail` or `All Mail` |
| iCloud | accountType `iCloud` | `Archive` |
| Other | — | `Archive` (fallback) |

```javascript
function findArchiveMailbox(account) {
  var mailboxes = account.mailboxes();
  var isGmail = account.serverName().indexOf("gmail.com") !== -1;
  var targets = isGmail
    ? ["[Gmail]/All Mail", "All Mail"]
    : ["Archive"];

  for (var t = 0; t < targets.length; t++) {
    for (var i = 0; i < mailboxes.length; i++) {
      if (mailboxes[i].name() === targets[t]) return mailboxes[i];
    }
  }
  return null;
}
```

## Moving a Message

```javascript
var archiveBox = findArchiveMailbox(msg.mailbox().account());
if (archiveBox) {
  app.move(msg, { to: archiveBox });
}
```

## Batch Archiving

Process in reverse index order to avoid index shifting:

```javascript
for (var i = toArchive.length - 1; i >= 0; i--) {
  app.move(messages[toArchive[i]], { to: archiveBox });
}
```

## Gmail Notes

- "All Mail" may appear as `[Gmail]/All Mail` or just `All Mail` depending on IMAP config
- Test with a single message first before batch operations
