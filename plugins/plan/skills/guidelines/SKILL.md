---
name: plan:guidelines
description: |
  Detailed planning guidelines and best practices. Use when you want explicit guidance on creating high-quality implementation plans, or when a plan was rejected and you need to understand why.
---

# Planning Guidelines

@references/guidelines.md

## Extended Guidance

### Reading Before Planning

Before proposing any changes:

1. Read the files you intend to modify
2. Understand the existing patterns and conventions
3. Identify related code that might be affected
4. Check for existing tests that cover the area

### Plan Structure

A good plan includes:

- **Context**: What problem are we solving? What's the current state?
- **Changes**: Specific files and modifications, with line references
- **Dependencies**: What must happen in order? What can be parallelized?
- **Verification**: How do we confirm success? What tests to run?
- **Risks**: What could go wrong? How do we recover?

### Scope Management

Plans should match the request exactly:

- If asked to fix a bug, don't refactor surrounding code
- If asked to add a feature, don't add "nice to have" extras
- If asked to refactor, don't fix unrelated issues you notice
- Document out-of-scope observations separately if important

### When Plans Get Rejected

Common reasons for plan rejection:

- Too vague (no specific file/line references)
- Too broad (scope creep beyond the request)
- Missing verification steps
- Ignoring existing patterns in the codebase
- Proposing changes to unread code
