---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?unset[^\n]*OTEL_LOGS_EXPORTER|<issue>(?:(?!</issue>)[\s\S])*?OTEL_LOGS_EXPORTER[^\n]*(?:unset|remov)'
flags: i
match: contains
---
The issue keeps the preview workaround: unset OTEL_LOGS_EXPORTER.
