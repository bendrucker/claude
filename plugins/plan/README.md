# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skill** `plan:review`: reviews how an implementation diverged from its approved plan, forking a clean-context agent over the plan and the diff to surface drift and follow-ups
- **Hook**: Injects planning guidelines the first time a session is in plan mode, whether that first signal is a prompt or a tool call, and appends delegation guidance when the orchestrator runs on an expensive model
- **Hook**: Gates `ExitPlanMode`, denying byte-identical plan re-presents, asking on an append-only re-present, asking once per session when a third or later present exceeds every earlier one, and asking once per session before presenting a plan over 12k characters

## How It Works

Two hooks share one job: inject the guidelines exactly once per plan-mode session. The `UserPromptSubmit` hook (`scripts/context.sh`) catches a prompt submitted while already in plan mode. A `PreToolUse` hook (`scripts/plan-inject.sh`, matcher `*`) catches the case where a session toggles into plan mode after its last prompt, so no `UserPromptSubmit` fires before `ExitPlanMode`. `permission_mode` rides on every `PreToolUse`, so the first tool call in plan mode is a reliable injection point. Both read `permission_mode` and share a `plan-injected` marker under `$CLAUDE_PLAN_MARKER_ROOT/<session_id>/`, so whichever fires first wins and the other short-circuits.

Both paths call `scripts/injection-content.sh` to assemble the content. It emits `references/guidelines.md` always, and reads the latest assistant `model` from the transcript. When that model is an expensive orchestrator (opus, fable, mythos), it appends `references/delegation.md`, which requires the plan to carry a Delegation section laying out the agent/model/effort DAG. `UserPromptSubmit` returns the content on stdout; `PreToolUse` returns it as `hookSpecificOutput.additionalContext`. Any read or parse problem falls back to the guidelines alone.

The `PreToolUse` gate hook keeps per-session state under `/tmp/claude/<session_id>/` and runs four checks in order. It denies a resubmission whose text is byte-identical to the last presentation. It asks when a re-present keeps nearly every prior line and only adds new ones. It asks once per session when the third or later present is longer than every present before it, the shape of a plan that accumulates residue instead of shedding it. The baseline is that high-water mark rather than the first present, because `Direction Before Detail` prescribes a skeletal first plan. It asks once per session for plans over 12k characters. Infrastructure weirdness (missing session id, unreadable state) fails open.

`plan:review` reads the approved plan from the file Claude Code writes under `~/.claude/plans/` and injects into the session on plan exit. It forks a clean-context agent that diffs the plan against the branch's base (resolved from the open PR, not assumed to be `main`) using the rubric in `skills/review/references/divergence.md`.

## Testing

```sh
bun test plugins/plan
```
