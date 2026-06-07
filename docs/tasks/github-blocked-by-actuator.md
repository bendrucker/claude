# GitHub blocked_by actuator

File a durable personal block as a GitHub issue with a native `blocked_by` dependency.

#### Context

Spec: [Durable issue](../blocking-dispatch.md#form-actuators) actuator. GitHub gained native issue dependencies (GA Aug 2025).

#### Depends on

- `work-personal-routing.md`
- `teleport-doorway-handoff.md`
- `markers-and-dedup.md`

These pull in `dispatch-skill-scaffold.md` transitively.

#### Scope

The GitHub path for a durable block on a personal repo:

- Create the issue through the `github` MCP server with a self-sufficient body drafted through `writing:writing`.
- Set the dependency through the REST `dependencies/blocked_by` endpoint or the GraphQL `addBlockedBy` mutation, so the downstream work issue is blocked by this one.
- Embed the teleport doorway and the `Session:` marker, and run the dedup check via issue search.

#### Out of scope

The Linear path (own task). The routing decision (own task).

#### Approach

Create the issue with the MCP tool, then set the dependency by calling the REST or GraphQL API through `gh api` (the `github:gh` convention), since the `gh` CLI lacked native dependency flags as of the research. Make the queue queryable through `is:blocked`. Reuse the doorway and marker tasks rather than reimplementing them. The issues this files are later worked through the `issue:issue` skill, which takes an issue URL and implements it, so a self-sufficient body pays off downstream.

#### Acceptance criteria

- [ ] A durable personal block creates a GitHub issue with a `blocked_by` edge.
- [ ] The issue carries the teleport doorway and `Session:` marker.
- [ ] `is:blocked` surfaces the issue, and dedup suppresses a repeat.

#### References

- [GitHub issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies)
- [GA changelog](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)
- `plugins/github/skills/gh/SKILL.md` for the `gh api` pattern
- `teleport-doorway-handoff.md`, `markers-and-dedup.md`
