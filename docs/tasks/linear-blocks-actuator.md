# Linear blocks actuator

File a durable work block as a Linear issue with a native `blocks` relation.

#### Context

Spec: [Durable issue](../blocking-dispatch.md#form-actuators) actuator. Linear models blocking as a first-class relation.

#### Depends on

- `work-personal-routing.md`
- `teleport-doorway-handoff.md`
- `markers-and-dedup.md`

These pull in `dispatch-skill-scaffold.md` transitively.

#### Scope

The Linear path for a durable block on a day-job repo:

- Create the issue through the Linear MCP tools (`create_issue`, or `save_issue` via the Claude.ai connector) with a self-sufficient body drafted through `writing:writing`.
- Set the relation through `issueRelationCreate` with `type: blocks`, so the downstream work issue is blocked by this one. The MCP tools do not expose relations, so run this mutation through the `linear api` GraphQL CLI.
- Embed the teleport doorway and the `Session:` marker, and run the dedup check via a `linear api` relations query.

#### Out of scope

The GitHub path (own task). The routing decision (own task).

#### Approach

Use the `linear` skill. Create the issue with the MCP tool, then set the relation with `linear api 'mutation { issueRelationCreate(...) }'`. Remember that `blocks` and `blocked-by` are the same relation viewed from opposite ends, so create one relation, not two. Read back through the issue's `relations` connection to confirm the block. Reuse the doorway and marker tasks.

#### Acceptance criteria

- [ ] A durable work block creates a Linear issue with a `blocks` relation.
- [ ] The issue carries the teleport doorway and `Session:` marker.
- [ ] The relations query confirms the block, and dedup suppresses a repeat.

#### References

- [Linear issue relations](https://linear.app/docs/issue-relations)
- `plugins/linear/skills/linear/SKILL.md`, the `linear` skill, for MCP create and the `linear api` GraphQL pattern (its `api.md` reference)
- `teleport-doorway-handoff.md`, `markers-and-dedup.md`
