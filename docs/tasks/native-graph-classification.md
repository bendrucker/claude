# Native graph classification

Drive blocking classification from the native task dependency graph rather than a heuristic.

#### Context

Spec: [The native task graph now models blocking](../blocking-dispatch.md#the-native-task-graph-now-models-blocking) and [Classification from the native graph](../blocking-dispatch.md#classification-from-the-native-graph). The graph is the spine.

#### Depends on

- `dispatch-skill-scaffold.md`

#### Scope

The graph-backed classifier:

- Gate on Claude Code v2.1.142+, where the native task tools expose dependencies.
- Model a stuck finding by creating the finding task and linking the downstream resume task with `addBlockedBy`.
- Treat any node with a dependent resume task as blocking.
- Fall back to a flat list and an explicit blocking marker on older versions.

#### Out of scope

The high-stakes trigger (own task), which sits on top of this. The gate interaction.

#### Approach

Use `TaskCreate` for the finding and `TaskUpdate` `addBlockedBy` to link the resume task, reading IDs from the `tool_result`. Detect the Claude Code version and branch to the flat-list fallback when the task tools are absent or `CLAUDE_CODE_ENABLE_TASKS=0` forces legacy `TodoWrite`. Keep the resume task in the graph so resolving the block makes it actionable.

#### Acceptance criteria

- [ ] On v2.1.142+, a stuck finding produces an `addBlockedBy` edge and reads as blocking.
- [ ] Resolving the blocker makes the resume task actionable.
- [ ] On older versions, the flat-list fallback still classifies blocking.

#### References

- [Claude Code task tracking](https://code.claude.com/docs/en/agent-sdk/todo-tracking)
- [blocking-dispatch.md, classification from the native graph](../blocking-dispatch.md#classification-from-the-native-graph)
