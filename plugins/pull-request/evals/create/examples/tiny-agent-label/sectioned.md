---
fail:
  - ceiling
  - names-round
---
Title: prompting: add first agent label

Adds an agent label for rule precision so the scan has ground truth to score against.

## Context

The audit round produced a squash commit that now serves as the first labeled example, which lets the scanner measure whether its rules fire on the text a person corrected.

## Testing

No behavior change outside the label list.
