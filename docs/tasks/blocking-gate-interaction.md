# Blocking gate interaction

Present a block to the user through `AskUserQuestion` plus push, with approve, deny, or edit for a gate and an open question for a stuck decision.

#### Context

Spec: [Blocking gate transport](../blocking-dispatch.md#blocking-gate-transport) and the Gate interaction decision. Push is the attention signal.

#### Depends on

- `dispatch-skill-scaffold.md`
- `reachability-detection.md`
- `high-stakes-classifier.md`

#### Scope

The interactive blocking path:

- For a high-stakes gate, show the diff or command and offer approve, deny, or edit first.
- A denial halts the action and Claude asks what to do instead rather than guessing.
- For a stuck decision, ask the open question that unblocks the work.
- When `reachability-detection` reports headless, do not call `AskUserQuestion`. Hand off to the durable issue path.

#### Out of scope

The durable issue actuators and the teleport doorway (their own tasks). This task owns the interactive branch and the headless handoff decision.

#### Approach

Use `AskUserQuestion` with options shaped per case: approve, deny, edit for gates, and the decision options for stuck. Render the diff or command so the choice is actionable from a phone. On deny, follow up with a what-instead question. Gate every `AskUserQuestion` call behind the reachability check so a headless run never stalls on an empty answer.

#### Acceptance criteria

- [ ] A gate shows the diff or command with approve, deny, edit.
- [ ] A denial halts and asks what to do instead.
- [ ] A stuck case asks the unblocking question.
- [ ] A headless session skips `AskUserQuestion` and hands off to the durable path.

#### References

- [blocking-dispatch.md, blocking gate transport](../blocking-dispatch.md#blocking-gate-transport)
- `reachability-detection.md`
- `high-stakes-classifier.md`
