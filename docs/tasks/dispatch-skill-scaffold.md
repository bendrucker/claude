# Dispatch skill scaffold

Create the user-level `dispatch` skill that classifies a finding and routes it, owning no storage of its own.

#### Context

Spec: [Dispatch router](../blocking-dispatch.md#dispatch-router) and [Architecture](../blocking-dispatch.md#architecture). The router is the spine that every other task plugs into.

#### Depends on

None. This is the foundation.

#### Scope

Create `user/skills/dispatch/SKILL.md`, a user-level skill like `improve-claude-code`, `doc-coauthoring`, and `improve-codebase-architecture` under `user/skills/`. The skill encodes the classification decision tree and the routing table as instructions, with placeholders that later tasks fill in:

- Frontmatter with `name: dispatch` and a description that triggers when Claude finds something worth surfacing. Unlike `improve-claude-code`, which sets `disable-model-invocation: true` because the user invokes it deliberately, dispatch is model-invocable: it must fire reactively mid-task.
- `allowed-tools` covering the actuators: `Skill(things:inbox)` and `Skill(things:jxa)` (capture and dedup scan), `Skill(pull-request:create)`, `Skill(writing:writing)` for any prose written for others, the `github` and `linear` MCP tools plus `Bash(gh:*)`, `AskUserQuestion`, and the native `Task*` tools.
- The classification section: blocking when stuck or high-stakes, non-blocking otherwise.
- The routing table: form selection by confidence and blast radius.
- Section stubs that reference the per-lane tasks (FYI capture, safe PR, gate, durable issue).

Note that `agent-ideas` is a useful pattern source for the doorway and capture flow, but it lives in `.claude/skills/` (project-level), not `user/skills/`.

#### Out of scope

The actuator logic itself. Each lane is its own task. This file is the skeleton and the decision tree only.

#### Approach

Model the structure on `user/skills/improve-claude-code/SKILL.md`: a short intro, then named sections in call order. Load `claude-code:skill` for authoring conventions. Keep the decision tree readable as prose plus one routing table. Reference the spec inline so the skill stays thin and the spec stays the source of truth. Any prose the skill emits for others (issue bodies, PR bodies, captures) goes through `writing:writing` per the user's global instructions.

#### Acceptance criteria

- [ ] `user/skills/dispatch/SKILL.md` exists with valid frontmatter.
- [ ] `bun run skill-lint "user/skills/dispatch/*"` passes.
- [ ] The classification tree and routing table match the spec.
- [ ] Each lane has a stub section pointing at its task.

#### References

- [blocking-dispatch.md](../blocking-dispatch.md)
- `user/skills/improve-claude-code/SKILL.md`
- `claude-code:skill`
