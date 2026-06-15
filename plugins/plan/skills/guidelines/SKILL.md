---
name: plan:guidelines
description: |
  Detailed planning guidelines and best practices. Use when you want explicit guidance on creating high-quality implementation plans, or when a plan was rejected and you need to understand why.
disable-model-invocation: true
---

# Planning Guidelines

@references/guidelines.md

## Plan Shape

Lead with grounding, then order the substance: Context, New Terms, Changes (by dependency), Verification. The sections above define each.

## Rejection Diagnosis

When a plan is rejected, the cause is usually one skipped guideline. Match the redirect to its section:

- Redirect points at a file or caller you did not read: Grounding.
- Redirect restores a constraint you dropped (a stop instruction, a "not acceptable", a required order): Grounding.
- Redirect says the fix targets the wrong thing or rests on an unconfirmed premise: Grounding.
- Redirect shrinks the work: Minimal-First Scope.
- Redirect rejects the whole approach: Direction Before Detail.
- Redirect questions a coined name or an undefined term: New Terms.
- Redirect says a check proves nothing: Verification.
- Redirect cites a naming or layout convention: Naming and Conventions.

Fix only the line the redirect targeted, then re-present.
