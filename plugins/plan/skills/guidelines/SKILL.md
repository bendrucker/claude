---
name: plan:guidelines
description: |
  Detailed planning guidelines and best practices. Use when you want explicit guidance on creating high-quality implementation plans, or when a plan was rejected and you need to understand why.
disable-model-invocation: true
---

# Planning Guidelines

@references/guidelines.md

## Plan Shape

Grounding comes first, then the substance. A plan usually carries:

- Context with grounding: the problem and current state, callers cited by `file:line`, the explicit constraints quoted, and for a fix the evidence it was confirmed against.
- New terms: any coined or borrowed term defined on first use, marked by where it comes from.
- Changes: the specific edits, ordered by dependency.
- Verification: at least one criterion that fails when the change is wrong while the suite still passes.

## Rejection Diagnosis

When a plan is rejected, the cause is usually one skipped guideline. Match the redirect to the section that prevents it:

- Redirect points at a file or caller you did not read: Grounding. Read every consumer before proposing the interface.
- Redirect restores a constraint you dropped (a stop instruction, a "not acceptable", a required order): Grounding. The request is a constraint set.
- Redirect says the fix targets the wrong thing or rests on an unconfirmed premise: Grounding. Confirm the failure against a repro, telemetry, or the actual source.
- Redirect shrinks the work: Minimal-First Scope. Lead with the smallest responsive change.
- Redirect rejects the whole approach: Direction Before Detail. Validate the approach before specifying mechanism.
- Redirect questions a coined name or an undefined term: New Terms. Define it and say where it comes from. Cut undefinable coinage.
- Redirect says a check proves nothing: Verification. Name a signal that fails when the change is wrong.
- Redirect cites a naming or layout convention: Naming and Conventions.

Fix only the line the redirect targeted, then re-present. Leave unaffected sections alone.
