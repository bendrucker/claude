---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?\]\(https://docs\.example-warehouse\.com/sql/copy#csv-format\)'
flags: m
match: contains
---
The body links the warehouse COPY reference inline where it says the loader accepts CSV.
