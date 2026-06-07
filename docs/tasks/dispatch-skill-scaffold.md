# Dispatch skill scaffold

Create the user-level `dispatch` skill that classifies a finding and routes it, owning no storage of its own.

#### Context

Spec: [Dispatch router](../blocking-dispatch.md#dispatch-router) and [Architecture](../blocking-dispatch.md#architecture). The router is the spine that every other task plugs into.

#### Depends on

None. This is the foundation.

#### Scope

Create `user/skills/dispatch/SKILL.md` alongside `improve-claude-code` and `agent-ideas`. The skill encodes the classification decision tree and the routing table as instructions, with placeholders that later tasks fill in:

- Frontmatter with `name: dispatch`, a description that triggers on Claude finding something worth surfacing, and `allowed-tools` covering the actuators (`Skill(things:inbox)`, `Skill(pull-request:create)`, the `github` and `linear` MCP tools, `AskUserQuestion`, the native `Task*` tools).
- The classification section: blocking when stuck or high-stakes, non-blocking otherwise.
- The routing table: form selection by confidence and blast radius.
- Section stubs that reference the per-lane tasks (FYI capture, safe PR, gate, durable issue).

#### Out of scope

The actuator logic itself. Each lane is its own task. This file is the skeleton and the decision tree only.

#### Approach

Model the structure on `improve-claude-code/SKILL.md`: a short intro, then named sections in call order. Load `claude-code:skill` for authoring conventions. Keep the decision tree readable as prose plus one routing table. Reference the spec inline so the skill stays thin and the spec stays the source of truth.

#### Acceptance criteria

- [ ] `user/skills/dispatch/SKILL.md` exists with valid frontmatter.
- [ ] `bun run skill-lint "user/skills/dispatch/*"` passes.
- [ ] The classification tree and routing table match the spec.
- [ ] Each lane has a stub section pointing at its task.

#### References

- [blocking-dispatch.md](../blocking-dispatch.md)
- `user/skills/improve-claude-code/SKILL.md`
- `claude-code:skill`
