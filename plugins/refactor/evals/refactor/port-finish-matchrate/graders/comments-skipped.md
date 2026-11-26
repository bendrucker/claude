---
type: regex
target: { source: file, path: src/report.ts }
pattern: 'startsWith\(\s*["''`]#|/\^\\s\*#|/\^#|\[0\]\s*===?\s*["''`]#'
---
Comment lines are skipped as the legacy parser does. Without this, every input with a comment throws, which hides the divergences after it.
