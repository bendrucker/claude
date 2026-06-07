# Teleport doorway handoff

Attach a resumable teleport doorway to a durable block so you can reopen the exact session and respond.

#### Context

Spec: [Handoff](../blocking-dispatch.md#handoff) and the headless branch of [Data flow](../blocking-dispatch.md#data-flow). Reuses the doorway pattern `agent-ideas` already uses.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

The handoff artifact embedded in a durable block:

- The `claude --teleport <session>` command, formatted so it is tappable.
- A short framing that names what the session is blocked on, so the issue is self-sufficient.
- Placement in the GitHub or Linear issue body the actuators create.

#### Out of scope

Creating the issue itself (the actuator tasks). This task owns the doorway content and format.

#### Approach

Copy the doorway shape from `agent-ideas` Deliver the Doorway Item, adapted from a Things note to an issue body. Put the teleport command on its own line. Confirm a teleport from the issue lands in a session with the original context.

#### Acceptance criteria

- [ ] The doorway carries `claude --teleport <session>` on its own line.
- [ ] The framing names the block so the issue stands alone.
- [ ] The actuators embed the doorway in the issue body.

#### References

- `.claude/skills/agent-ideas/SKILL.md`, Deliver the Doorway Item
