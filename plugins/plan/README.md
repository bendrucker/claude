# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skills**:
  - `plan:critique`: runs parallel skeptic lenses (simplify, upstream maintainer, measurement, perf and concurrency) over a draft plan before its first presentation
  - `plan:review`: reviews how an implementation diverged from its approved plan, dispatching a clean-context agent over the plan and the diff to surface drift, missing measurement artifacts, and follow-ups
- **Hooks**:
  - `hooks/inject.ts`: adds `references/guidelines.md` as context the first time a session reaches plan mode, on a prompt submitted in plan mode or after `EnterPlanMode`, and again after a compaction
  - `hooks/gate.ts`: denies an `ExitPlanMode` whose plan fails `checkBrief` in `hooks/brief.ts` (a first `## Brief` with one approach paragraph, up to five `Decisions:` each citing a `Rejected:` alternative, a `Measure:` line, and a `Revised:` list on a presentation after a rejection), at most twice per session
  - `hooks/strip.ts`: on an in-session approval, removes the Brief's `Revised:` list from the plan file and clears the gate's revision marker. A "clear context" approval records `ExitPlanMode` as rejected and skips it, so the guidelines tell the implementer to ignore `Revised:`
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
