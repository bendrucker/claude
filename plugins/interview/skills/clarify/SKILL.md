---
name: interview:clarify
disable-model-invocation: true
description: |
  Targeted interview for execution-time clarification. Use when you hit an ambiguity or decision point during implementation that needs user input before proceeding.
context: fork
---

# Clarification Interview

Resolve a specific blocker via the `AskUserQuestion` tool.

## Rules

- Every question goes through `AskUserQuestion`. Never list questions in chat prose.
- One blocker at a time. 1-2 questions per call; 4 is the cap.
- If the answer would not change your next action, do not ask.

## Open-Ended Questions

Even when the answer space feels open, sketch 2-4 plausible options. The user gets "Other" automatically (do not add it). If you cannot name two distinct options, read more code first.

When you have a recommendation, put it first and append "(Recommended)" to the label.

## Output

Resume implementation after receiving answers. Do not write to files.
