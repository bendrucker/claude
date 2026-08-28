# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skill** `plan:review`: reviews how an implementation diverged from its approved plan, forking a clean-context agent over the plan and the diff to surface drift and follow-ups
- **Hook**: Injects planning guidelines the first time a session reaches plan mode, whether that first signal is the `EnterPlanMode` call, a prompt, or a tool call, and appends delegation guidance when the orchestrator runs on an expensive model
- **Hook**: Gates `ExitPlanMode`, denying byte-identical plan re-presents, a re-present that carries the prior plan nearly intact, once per session a re-present that exceeds every present before it, and a plan over 10k characters, re-arming while a rework stays over the threshold up to two fires per session

## How It Works

Two hooks share one job: inject the guidelines exactly once per plan-mode session. The `UserPromptSubmit` hook (`scripts/context.sh`) catches a prompt submitted while already in plan mode. A `PreToolUse` hook (`scripts/plan-inject.sh`, matcher `*`) catches the case where a session toggles into plan mode after its last prompt, so no `UserPromptSubmit` fires before `ExitPlanMode`. `permission_mode` rides on every `PreToolUse`, so the first tool call in plan mode is a reliable injection point. No matcher expresses "whichever tool comes first in plan mode", so the entry keeps matcher `*` and the script tests the raw payload with a shell `case` before spawning `jq`, so a tool call outside plan mode exits without the parse. Both read `permission_mode` and share a `plan-injected` marker under `$CLAUDE_PLAN_MARKER_ROOT/<session_id>/`, so whichever fires first wins and the other short-circuits.

A third entry registers the same script on `PostToolUse` with matcher `EnterPlanMode`. A session that researches in auto mode, enters plan mode, and writes the plan in one turn reaches its next tool call only at `ExitPlanMode`, so under the `PreToolUse` entry alone the guidelines arrive after the plan they were meant to shape. This entry needs no mode test, because `EnterPlanMode` carries the pre-switch mode before it runs. `PostToolUse` is what makes it safe: reaching it means the call landed, so an interrupted `EnterPlanMode` cannot spend the marker and silence both paths for the rest of the session. The script also exits on a payload carrying `agent_id`, since a subagent's call would otherwise spend the parent's marker on context only the subagent sees.

Both paths call `scripts/injection-content.sh` to assemble the content. It emits `references/guidelines.md` always, and reads the latest assistant `model` from the transcript. When that model is an expensive orchestrator (opus, fable, mythos), it appends `references/delegation.md`, which requires the plan to carry a Delegation section laying out the agent/model/effort DAG. `UserPromptSubmit` returns the content on stdout; `PreToolUse` returns it as `hookSpecificOutput.additionalContext`. Any read or parse problem falls back to the guidelines alone.

The `PreToolUse` gate hook keeps per-session state under `/tmp/claude/<session_id>/` and runs four checks in order. It denies a resubmission whose text is byte-identical to the last presentation. It denies a re-present that carries nearly every prior line and introduces at least one new one, which catches a line swap that nets zero growth as well as a plain append. It denies, once per session, a re-present longer than every present before it, the shape of a plan that accumulates residue instead of shedding it, measured against that high-water mark rather than the present just before. It denies a plan over 10k characters, the same limit the injected guidelines state, re-arming while a rework remains over the threshold, capped at two fires per session so a deny loop is impossible.

Every check denies, including the three that read as advice. A `PreToolUse` hook's `permissionDecision: "ask"` is inert on `ExitPlanMode`: the tool runs its own plan-approval prompt, and the harness drops the hook's `permissionDecisionReason` and `systemMessage` alike, so neither the user nor the transcript sees them. `deny` is the only decision that carries a reason back. Each denial is recoverable in one step, since the model reworks the plan and presents again, and the growth and size checks spend their marker on first use. `hooks/fixtures/re-presents.json` holds presentation sequences recorded from real sessions. `gate.test.ts` replays them one process per presentation and snapshots the `permissionDecision` alongside the rule, so a check that stops deciding surfaces as a changed snapshot rather than as silence.

A missing session id or a plan that is not a string fails open silently, since neither is a fault. Anything else, an unusable state directory or a crash mid-decision, prints to stderr and exits 1: the presentation still goes through, and the failure is visible rather than reading as a plan that passed every check.

Each denial reason states the fix directly: rework against the feedback, delete superseded text, move detail to sidecar files, or split the plan.

`plan:review` reads the approved plan from the file Claude Code writes under `~/.claude/plans/` and injects into the session on plan exit. It forks a clean-context agent that diffs the plan against the branch's base (resolved from the open PR, not assumed to be `main`) using the rubric in `skills/review/references/divergence.md`.

## Testing

```sh
bun test plugins/plan
```
