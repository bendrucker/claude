---
type: regex
pattern: '^```diff(?=(?:(?!```)[\s\S])*?^\+[^\n]*<\w*(?:date|range)\w*)(?=(?:(?!```)[\s\S])*?^ [^\n]*<RevenueChart)'
flags: mi
match: contains
---
The diff adds a picker component beside the unchanged charts.
