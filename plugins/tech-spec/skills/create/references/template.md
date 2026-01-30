# Template Structure

## Required Sections

### Title

The feature or project name.

### Problem

Restate the problem from product requirements. Keep it concise.

### Architecture

High-level system design:

- **Diagram**: Mermaid flowchart showing components and data flow (use `mermaid:diagram`)
- **Data Flow**: Numbered steps explaining the sequence
- **Design Decisions**: Table capturing trade-offs (see main skill for format)

### Implementation

Scaffolding for the technical work. Subsections vary by project. Common categories:

| Section | When to Include |
|---------|-----------------|
| Database | Schema changes, new tables, migrations |
| API | New endpoints, request/response schemas |
| App | Frontend components, state management |
| Infrastructure | Secrets, environment variables, deployment |
| Services | Background jobs, integrations, external APIs |
| Security | Auth, permissions, data protection |

Adapt based on what's relevant. Add sections as needed during exploration.

For each subsection:
- Code snippets only when they clarify the change
- Reference existing patterns in the codebase
- Note dependencies between components

### Milestones

Incremental delivery plan:

- What logical units can ship independently?
- Customer-facing value at each stage?
- Feature flag strategy
- Internal testing approach

Focus on deliverables and validation, not implementation.

### References

Links to related resources:

- Project tracking (Linear project, GitHub milestone, etc.)
- Product requirements document
- Related documentation
- External API docs or specs

High-level navigation; prefer inline links elsewhere.
