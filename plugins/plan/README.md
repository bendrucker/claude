# Plan

Planning mode guidelines and context injection for Claude Code.

## Contents

- **Skill** `plan:review`: reviews how an implementation diverged from its approved plan, dispatching a clean-context agent over the plan and the diff to surface drift and follow-ups
- **Hooks**:
  - `hooks/gate.ts`: gates `ExitPlanMode`, denying an unchanged plan resubmission, a patch that keeps nearly every line of a plan the gate just denied, and a plan over 10k characters, re-arming while a rework stays over the threshold up to two fires per session
- **Mod** `mod/register.ts`:
  - Appends `references/guidelines.md` to the first full plan-mode reminder of the main conversation, and again after a compaction. Every request made in plan mode carries that reminder, however plan mode was reached, so one hook covers a prompt, `EnterPlanMode`, and a mode toggle. Subagent reminders are skipped.
  - Attaches `references/delegation.md` as tool-result context the first time a `Write` or `Edit` takes the plan file to half the gate's limit without a `Delegation` heading, once per plan file.
  - Attaches a warning with the sidecar guidance after every `Write` or `Edit` that leaves the plan file over the gate's limit, so a draft is trimmed before it reaches `ExitPlanMode`. It keys on the plan file the reminder names, so a custom `plansDirectory` is covered.
  - After each `Write` or `Edit` to the plan file named in the plan-mode reminder, shows its size as a share of the gate's limit in the status line once it reaches 90% (`plan: 10.2k (102%)`, rounded down), counting `string.length` the way the gate does, and clears it when a plan is approved. `hooks/gate.test.ts` pins its limit to the gate's.
  - Through `mod-events` it logs `plan.inject` and `plan.delegation` for each injection (`ok: false` when the reference could not be read), `plan.count` for each count, `plan.crossed` whenever the count moves over or back under the limit, and `plan.present` for each `ExitPlanMode` with its size and whether it went through.
- **Evals** `evals/gate/`: mines every recorded presentation for `hooks/replay.test.ts`, which replays the corpus through the gate and fails on decisions that moved against a saved baseline

## How It Works

The `PreToolUse` gate hook keeps per-session state under `/tmp/claude/<session_id>/` and runs three checks in order. It denies a resubmission whose text is unchanged from the last presentation. It denies a resubmission that keeps nearly every line of a presentation the gate itself denied and introduces at least one new one, which catches a denied plan patched past the gate, by a line swap or a plain append. A presentation the gate passed went to the user, so the next one answers their feedback and may grow by what they asked for. It denies a plan over 10k characters, the same limit the injected guidelines state, re-arming while a rework remains over the threshold, capped at two fires per session so a deny loop is impossible.

Every check denies, including the two that read as advice. A `PreToolUse` hook's `permissionDecision: "ask"` is inert on `ExitPlanMode`: the tool runs its own plan-approval prompt, and the harness drops the hook's `permissionDecisionReason` and `systemMessage` alike, so neither the user nor the transcript sees them. `deny` is the only decision that carries a reason back. Each denial is recoverable in one step, since the model reworks the plan and presents again, and the size check spends its marker on first use. `hooks/fixtures/re-presents.json` holds presentation sequences recorded from real sessions. `gate.test.ts` replays them one process per presentation and snapshots the `permissionDecision` alongside the rule, so a check that stops deciding surfaces as a changed snapshot rather than as silence.

A missing session id or a plan that is not a string fails open silently, since neither is a fault. Anything else, an unusable state directory or a crash mid-decision, prints to stderr and exits 1: the presentation still goes through, and the failure is visible rather than reading as a plan that passed every check.

Each denial reason states the fix directly: rework against the feedback or the denial, move detail to sidecar files, or split the plan.

`plan:review` reads the approved plan from the file Claude Code writes under `~/.claude/plans/` and injects into the session on plan exit. It dispatches a clean-context agent that diffs the plan against the branch's base (resolved from the open PR, not assumed to be `main`) using the rubric in `skills/review/references/divergence.md`.

## Testing

```sh
bun test plugins/plan
bun scripts/mod-test.ts plan
```
