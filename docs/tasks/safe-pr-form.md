# Safe PR form

Auto-open a draft PR for a ready, safe fix, then drop a Things capture with the link.

#### Context

Spec: [Form selection](../blocking-dispatch.md#form-selection), Ready safe fix. The draft state is the safety gate, the PR is a proposal in your review queue.

#### Depends on

- `dispatch-skill-scaffold.md`
- `markers-and-dedup.md`

#### Scope

The fix path for a non-blocking finding Claude can resolve:

- Evaluate the safe-PR bar. All three must hold: tests pass locally, edits stay within the task's files and scope, lint and formatting are clean.
- When the bar passes, open a draft PR through `pull-request:create`.
- Drop a Things capture carrying the PR link so it joins inbox triage.
- When the bar fails, fall back to the FYI capture lane as a suggestion rather than a PR.

#### Out of scope

The FYI capture mechanics (own task). The branch and worktree workflow beyond what `pull-request:create` already handles.

#### Approach

Run the project's own test and lint commands to evaluate the bar, not a generic guess. Scope is judged against the files the current task touched. Use `pull-request:create` so the PR body and formatting follow the existing convention, and include the parent-context link. The capture reuses the FYI lane with the PR URL in the notes.

#### Acceptance criteria

- [ ] A draft PR opens only when all three bar conditions hold.
- [ ] A failing bar produces a suggestion capture, not a PR.
- [ ] The PR is draft, and a Things capture carries its link.

#### References

- `plugins/pull-request/skills/create/SKILL.md`
- `fyi-capture-lane.md`
