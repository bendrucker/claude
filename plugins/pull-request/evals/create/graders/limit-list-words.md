---
type: regex
target: { source: file, path: .eval-verdicts }
pattern: '^PR-LIMIT list-words=pass\b'
flags: m
match: contains
---
The last body the session handed to a create or edit call stays within the `listWords` guard in `pr-body/structure.ts`, from the `PR-LIMIT` line the gh or glab stand-in recorded in `.eval-verdicts`. A `--dry-run` or a body under three words does not count, and the grader fails when no counted create or edit reached the stand-in.
