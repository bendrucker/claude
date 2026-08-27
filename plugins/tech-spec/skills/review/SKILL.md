---
name: tech-spec:review
description: Review an existing technical specification for gaps, risks, and missing considerations.
---

# Review Technical Specification

## Inputs

Ask the user to provide:

- **Tech spec**: Path to the specification file, or pasted content
- **Focus areas** (optional): Specific concerns to prioritize (e.g., "security", "API design")
- **Repositories** (optional): Codebases to consult when verifying spec claims

## Code Exploration

When repositories are provided, consult code to verify:
- Proposed patterns match existing conventions
- Referenced files and structures exist
- Implementation assumptions are accurate

Explore on demand during review, not upfront.

## Review Process

### Identify Expert Perspectives

Select relevant personas from [references/experts.md](references/experts.md):
- Always include standard personas (security, API, database, etc.)
- Add dynamic personas based on spec content (integrations, analytics, etc.)
- User-specified focus areas get priority

### Conduct Review

For each persona:

1. Scan the spec for areas within their expertise
2. Identify findings: gaps, risks, unclear decisions, missing considerations
3. Rate severity: blocking, important, or nice-to-have

### Present Findings

Group related findings into batches and present via `AskUserQuestion`:

- Batch by persona or topic when findings cluster naturally
- Present individually when no natural grouping exists
- Include severity and recommendations

### Interview for Resolution

For findings with meaningful trade-offs:
- Discuss alternatives with the user
- Capture decisions in the Design Decisions table
- Update the spec with resolutions

### Update Spec

Apply agreed changes to the spec file:
- Add missing sections or considerations
- Expand the Design Decisions table
- Clarify ambiguous areas
