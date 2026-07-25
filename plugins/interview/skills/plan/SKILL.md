---
name: interview:plan
description: |
  Comprehensive interview for planning new features or changes. Use when the user wants thorough upfront planning before implementation, or when starting work on a complex feature.
---

# Planning Interview

Interview the user about their requested change via the `AskUserQuestion` tool.

## Rules

- Every question goes through `AskUserQuestion`. Never list questions in chat prose.
- Up to 4 questions per call, batched by topic. The cap is per call, not per interview: chain calls until the plan is solid.
- Refine the next batch based on prior answers. Do not pre-plan all questions.

## Open-Ended Questions

Even when the answer space feels open, sketch 2-4 plausible options. The user gets "Other" automatically (do not add it). If you cannot name two distinct options, read more code or ask a more foundational question first.

When you have a recommendation, put it first and append "(Recommended)". For visual or code comparisons, use the `preview` field on options.

## Topics

Adapt to context. Skip obvious answers. Challenge implicit decisions.

- Requirements: what it should and shouldn't do
- Technical implementation: architecture, data flow, dependencies
- UI/UX: interactions, feedback, error states
- Constraints: performance, compatibility, security, accessibility
- Tradeoffs and scope boundaries
- Validation: how we know it works

## Output

The interview informs the conversation. Do not write to files unless the user requests it.
