---
name: tech-spec:create
description: |
  Create a technical specification through interactive planning and expert review. Use when starting a new feature or project that needs documented architecture, implementation approach, and design decisions. Invoke with product requirements (PRD, brief, or similar).
---

# Create Technical Specification

## Workflow

### Gather Inputs

Ask the user to provide:

- **Product requirements**: PRD, product brief, or similar. Accept local files (`@path/to/file.md`), URLs (fetch via appropriate tools), or pasted content.
- **Project tracking context**: A project, epic, or initiative in their task management system (Linear, GitHub, Jira, etc.). Use available MCP tools to fetch details.
- **Output path**: Where to write the spec (e.g., `tmp/feature-tech-spec.md`).

Be flexible about input sources. Don't assume specific tools or formats.

### Explore Codebases

Discuss with the user which repositories need exploration:

- Suggest likely candidates based on the project scope
- Ask the user to confirm or identify additional repos
- Dispatch background explore agents for breadth-first discovery while the user is away

Scan for:
- Relevant existing patterns and conventions
- Database schemas and models
- API structure and routing
- Frontend component architecture
- Infrastructure and deployment configuration

### Planning Interview

Invoke `interview:plan` to clarify requirements. Guide the interview toward:

- Requirements clarification
- Scope boundaries (what's in, what's out)
- Technical constraints
- Integration points
- Rollout strategy

### Write Initial Draft

Write incrementally to the output file. Use the template structure from [references/template.md](references/template.md).

For architecture diagrams, always use `mermaid:diagram` to ensure proper syntax and rendering.

Write sections incrementally.

### Expert Review

Invoke `tech-spec:review` on the draft spec.

### Iterate

Continue refining until the user is satisfied. Long sessions with incremental changes create drift—validate consistency before concluding:

- **Stale references**: Scope changes in one section may leave dangling references elsewhere
- **Contradictions**: Later decisions may conflict with earlier sections
- **Orphaned details**: Implementation details that no longer match the architecture
- **Milestone alignment**: Ensure milestones still reflect the current scope

Also address:
- Expanding under-specified sections
- Adding missing edge cases or error handling
- Refining milestones for incremental delivery

## Design Decisions Table

Captures architecture trade-offs:

| Decision | Choice | Alternatives | Rationale | Notes |
|----------|--------|--------------|-----------|-------|
| Brief description | What we chose | What we didn't | Why this choice | Caveats, follow-ups |

Populate this table throughout the process as decisions emerge. Focus on:
- Choices that required deliberation
- Trade-offs between valid alternatives
- Decisions that future readers would question

Capture decision highlights, not interview dialogue.

## Style

- Describe structure and approach, not implementation details
- Use Mermaid for architecture diagrams
- Reference related code, docs, and issues inline
