---
type: regex
target:
  source: file
  path: src/reminders.ts
pattern: 'sendReminders\(\s*invoices\s*:\s*Invoice\[\]\s*,\s*today\s*:\s*string\s*,'
match: contains
---
`sendReminders` takes the email sender as a parameter, so the seam sits at the argument.
