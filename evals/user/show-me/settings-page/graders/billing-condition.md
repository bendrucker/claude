---
type: regex
pattern: 'BillingPanel[^\n]*(?:plan|free)|(?:plan|free)[^\n]*BillingPanel'
flags: i
match: contains
---
The reply keeps the paid-plan condition that gates the billing panel.
