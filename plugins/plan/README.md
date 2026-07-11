# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skill** `plan:review`: reviews how an implementation diverged from its approved plan, forking a clean-context agent over the plan and the diff to surface drift and follow-ups
- **Skill** `plan:grill`: relentless design-tree interview, drilling one `AskUserQuestion` at a time into whatever the prior answer opens up, ending in a decisions digest; runs when you ask to be grilled on a design or when another skill hands off its interview
- **Skill** `plan:clarify`: user-run targeted interview for resolving a single execution-time ambiguity
- **Hook**: Injects planning guidelines the first time a session is in plan mode, whether that first signal is a prompt or a tool call, and appends delegation guidance when the orchestrator runs on an expensive model
- **Hook**: Gates `ExitPlanMode`, denying byte-identical plan re-presents and asking once per session before presenting a plan over 12k characters

## How It Works

Two hooks share one job: inject the guidelines exactly once per plan-mode session. The `UserPromptSubmit` hook (`scripts/context.sh`) catches a prompt submitted while already in plan mode. A `PreToolUse` hook (`scripts/plan-inject.sh`, matcher `*`) catches the case where a session toggles into plan mode after its last prompt, so no `UserPromptSubmit` fires before `ExitPlanMode`. `permission_mode` rides on every `PreToolUse`, so the first tool call in plan mode is a reliable injection point. Both read `permission_mode` and share a `plan-injected` marker under `$CLAUDE_PLAN_MARKER_ROOT/<session_id>/`, so whichever fires first wins and the other short-circuits.

Both paths call `scripts/injection-content.sh` to assemble the content. It emits `references/guidelines.md` always, and reads the latest assistant `model` from the transcript. When that model is an expensive orchestrator (opus, fable), it appends `references/delegation.md`, which requires the plan to carry a Delegation section laying out the agent/model/effort DAG. `UserPromptSubmit` returns the content on stdout; `PreToolUse` returns it as `hookSpecificOutput.additionalContext`. Any read or parse problem falls back to the guidelines alone.

The `PreToolUse` gate hook hashes each presented plan under `/tmp/claude/<session_id>/` and denies a resubmission whose text is unchanged since the last presentation, with instructions to revise instead of regrow. Plans over 12k characters trigger a one-time confirmation prompt. Infrastructure weirdness (missing session id, unreadable state) fails open.

`plan:review` reads the approved plan from the file Claude Code writes under `~/.claude/plans/` and injects into the session on plan exit. It forks a clean-context agent that diffs the plan against the branch's base (resolved from the open PR, not assumed to be `main`) using the rubric in `skills/review/references/divergence.md`.

`plan:grill` is model-invocable: ask to be grilled on a design and the model routes to it, and other skills (`tech-spec:create`, `improve-codebase-architecture`) can delegate their interview to it. Making it user-only would suppress both paths, the same trap that left the interview plugin dormant. It has no batch or call limit, chaining `AskUserQuestion` calls until the design is settled and challenging conflicting answers rather than proceeding past them. `plan:clarify` stays `disable-model-invocation` (user-run only, on a deathwatch) and is scoped to one blocker with a 4-question cap.

## Testing

```sh
bun test plugins/plan
```
