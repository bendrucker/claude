# Planning Guidelines

## Structure

- Reference specific files and line numbers from the existing codebase
- Include verification steps that confirm the plan succeeded
- Identify dependencies between steps (what must complete before what)
- Note any rollback considerations for risky changes

## Quality Checks

Before presenting a plan, verify:

- [ ] Each step references concrete code locations, not abstract descriptions
- [ ] The plan accounts for existing patterns in the codebase
- [ ] Edge cases and error scenarios are addressed
- [ ] The scope matches what was requested (no feature creep)

## Common Pitfalls

- Don't propose changes to code you haven't read
- Don't add abstractions, utilities, or "improvements" beyond the request
- Don't include time estimates
- Don't number steps in a way that implies rigid ordering unless order matters

## Skills

Mention which skills to activate at appropriate points in the execution lifecycle. Rather than a dedicated "Skills" section, reference skills inline where they're needed:

- "Use `pull-request:create` after committing changes"
- "Activate `typescript:typescript` for type-aware refactoring"
- "Load `git:git` before branch operations"
