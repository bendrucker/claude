---
type: regex
pattern: '^```mermaid(?:(?!```)[\s\S])*?^\s*S3\s*-{1,2}[>)x]{1,2}[+-]?\s*(?:Queue|Worker|Redis|Thumbnail)'
flags: mi
match: not_contains
---
The diagram keeps the real trigger, the API publishing to the queue, with no arrow from S3 into the queue or worker.
