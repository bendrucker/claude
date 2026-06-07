# Linear blocks actuator

File a durable work block as a Linear issue with a native `blocks` relation.

#### Context

Spec: [Durable issue](../blocking-dispatch.md#form-actuators) actuator. Linear models blocking as a first-class relation.

#### Depends on

- `dispatch-skill-scaffold.md`
- `work-personal-routing.md`
- `teleport-doorway-handoff.md`
- `markers-and-dedup.md`

#### Scope

The Linear path for a durable block on a day-job repo:

- Create the issue through the Linear MCP tools with a self-sufficient body.
- Set the relation through `issueRelationCreate` with `type: blocks`, so the downstream work issue is blocked by this one.
- Embed the teleport doorway and the `Session:` marker, and run the dedup check via a relations query.

#### Out of scope

The GitHub path (own task). The routing decision (own task).

#### Approach

Create the issue, then set the relation with `issueRelationCreate`. Remember that `blocks` and `blocked-by` are the same relation viewed from opposite ends, so create one relation, not two. Read back through the issue's `relations` connection to confirm the block. Reuse the doorway and marker tasks.

#### Acceptance criteria

- [ ] A durable work block creates a Linear issue with a `blocks` relation.
- [ ] The issue carries the teleport doorway and `Session:` marker.
- [ ] The relations query confirms the block, and dedup suppresses a repeat.

#### References

- [Linear issue relations](https://linear.app/docs/issue-relations)
- `plugins/linear/skills/notifications/SKILL.md` for the `linear api` pattern
- `teleport-doorway-handoff.md`, `markers-and-dedup.md`
