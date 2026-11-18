# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skill** `plan:review`: reviews how an implementation diverged from its approved plan, dispatching a clean-context agent over the plan and the diff to surface drift and follow-ups
- **Hooks**:
  - `hooks/inject.ts`: adds `references/guidelines.md` as context the first time a session reaches plan mode, on a prompt submitted in plan mode or after `EnterPlanMode`, and again after a compaction
  - `hooks/delegation.ts`: adds `references/delegation.md` as context the first time a `Write` or `Edit` takes a plan file under `~/.claude/plans/` to 5k characters without a `Delegation` heading, once per plan file
- **Mod** `mod/register.ts`: logs `plan.session.start` and a `plan.present` for each `ExitPlanMode` with the plan's size and whether it went through
- **Evals** `evals/brief/`: mines planning sessions the user redirected, for an A/B of the guidelines

`plan:review` reads the approved plan from the file Claude Code writes under `~/.claude/plans/` and diffs it against the branch's base using the rubric in `skills/review/references/divergence.md`.

The `plan-delivery` query in `observability:session` reports, per host and week, how many planning sessions received the guidelines.

## Testing

```sh
bun test plugins/plan
bun scripts/mod-test.ts plan
```
