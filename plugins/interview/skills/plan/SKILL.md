---
name: plan
description: |
  Comprehensive interview for planning new features or changes. Use when the user wants thorough upfront planning before implementation, or when starting work on a complex feature.
context: fork
agent: Plan
---

# Planning Interview

Interview the user comprehensively about their requested change using `AskUserQuestion`.

## Interview Topics

Cover these areas, adapting to context:

- **Requirements** - What exactly should this do? What shouldn't it do?
- **Technical implementation** - Architecture, data flow, dependencies, APIs
- **UI/UX** - User interactions, feedback, error states, edge cases
- **Constraints** - Performance, compatibility, security, accessibility
- **Tradeoffs** - What are you willing to sacrifice? What's non-negotiable?
- **Scope boundaries** - What's explicitly out of scope for this change?
- **Validation** - How will we know it works? What does success look like?

## Interview Style

- **Non-obvious questions** - Skip questions with obvious answers
- **In-depth** - Dig into specifics, follow interesting threads
- **Batch questions** - Use up to 4 questions per `AskUserQuestion` call
- **Continue until complete** - Keep interviewing until the plan feels solid
- **Challenge assumptions** - Surface implicit decisions that deserve explicit consideration

## Output

The interview informs the conversation. Do not write to files unless the user requests it.
