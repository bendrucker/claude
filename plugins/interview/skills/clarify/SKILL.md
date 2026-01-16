---
name: clarify
description: |
  Targeted interview for execution-time clarification. Use when you hit an ambiguity or decision point during implementation that needs user input before proceeding.
context: fork
---

# Clarification Interview

Ask targeted questions using `AskUserQuestion` to resolve a specific blocker.

## When to Use

- Implementation detail is ambiguous
- Multiple valid approaches exist
- Edge case behavior is undefined
- User preference affects the solution

## Interview Style

- **Focused** - Address the immediate blocker, not comprehensive coverage
- **Targeted** - Usually 1-2 questions at a time
- **Actionable** - Each question should unblock progress
- **Context-rich** - Explain why you're asking and what the options mean

## Output

Resume implementation after receiving answers. Do not write to files.
