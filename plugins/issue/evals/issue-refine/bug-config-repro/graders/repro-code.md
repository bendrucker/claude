---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?OTEL_LOGS_EXPORTER'
flags: m
match: contains
---
The body shows the reproduction as code: a fenced block with the env config that triggers the crash.
