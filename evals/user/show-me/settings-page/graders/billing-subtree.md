---
type: regex
pattern: '^```[^\n]*\n(?:(?!```)[\s\S])*?BillingPanel[^\n]*\n(?:(?!```)[\s\S])*?^[ │├└─]{2,}<?InvoiceList'
flags: m
match: contains
---
The billing section appears as a component tree down to the invoice list.
