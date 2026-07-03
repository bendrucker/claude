# Planning Guidelines

Most rejected plans miss something the code already contains or the request already states. Read the relevant code and restate the request's hard constraints before writing the plan.

## Grounding

Read before you propose, and show the reading in the plan's Context. These have to be present and concrete:

- Read the callers and consumers, and cite them by `file:line`. For a generalization, grep the call sites and state the count. What the call sites do is the contract.
- Quote the explicit constraints the user gave: a stop or pause instruction (which overrides plan mode), a "not acceptable", a required order. Treat an issue's Open Questions as decisions to surface, never as requirements you may assume were answered.
- For a fix, confirm the failure against observed evidence (a repro you ran, a telemetry query, or the exact lines you read) before proposing a mechanism. Do not assert pricing, flags, or API facts from memory when the source is reachable.
- When the code contradicts a premise of the request (a claimed behavior, an assumed default, a "this is broken"), surface the conflict with the `file:line` and let the user resolve it. Do not silently plan to the request when the code says otherwise.

A plan that proposes a signature, abstraction, constant list, or storage path without showing the code it has to fit is premature.

## Convergence Before Plan Mode

Investigate to convergence first. Plan mode transcribes findings that are already settled. An approved plan can spend under two minutes in plan mode because every choice was resolved before it opened.

- For an investigation task, present the root cause as standalone prose the user can correct before any fix plan exists. A diagnosis frozen inside a plan's Context gets regenerated verbatim instead of corrected.
- Subagents return findings. Author the plan in your own prose. A plan forwarded from a subagent cannot absorb a redirect, because its author never held the design reasoning.

## Minimal-First Scope

When the request names a vague noun ("a skill", "a few rules", "a workflow"), state the smallest change that satisfies the literal ask, then offer heavier work as named tiers. A guard, rule, or test that catches zero existing cases is speculative: ask before adding it.

This relaxes when the user asked for thorough upfront planning (`interview:plan`). There, depth is the point.

## Direction Before Detail

Confirm the approach before specifying file lists, line numbers, signatures, or test cases. If more than one viable approach exists, present the choice as a short tradeoff or an `AskUserQuestion` rather than a finished plan built around one option. A plan thrown out wholesale on first rejection was detailed too early.

## New Terms

When the plan introduces a term, type, field, or abstraction it then relies on, define it on first use and say where it comes from:

- From an established source: name the source (the OTel call, the DuckDB catalog function, the existing machinery it models). Naming the source forces the check of whether something upstream already covers it.
- Coined here: state in one line what it abstracts.

Inline on first use is enough. A separate definitions section is optional. Two rules hold either way:

- For a term that crosses a process or repo boundary (a wire field, manifest key, env var, step name, marker convention), also name its consumers and any open question.
- If you cannot write a one-line definition a reader new to this session would understand, cut the term and use plain language.

Defer naming to implementation when the deliverable is not the code itself (an issue, a design doc). Do not anchor the plan on a coined type, exception, or module name.

## Plan Shape

The plan is a do-now spec:

- Open with the non-negotiable conventions and a stop condition (implement, ship, end). Without a stop condition, the implementing session absorbs the next job too.
- Deferred design goes to a separate linked file the implementer is told not to open, with one pointer line in the plan. A handoff plan heavy with deferred design forces the implementing session to re-plan work the original session never resolved.
- Resolved decisions and research synthesis move to a companion `<plan>-decisions.md` that the plan links.
- Keep plans focused and under roughly 10k characters. Past that, plans get rejected: split the scope or consolidate before presenting.

## Verification

Aim for at least one criterion that fails when the change is wrong while the suite still passes. The shape:

```
- Signal: <observable: query result, rendered string, exit code, span attribute, row count>
  Observe via: <command or query>
  Pre-fix: <current value>   Pass: <expected value>
```

Without the before/after contrast, a criterion only restates intent. Mechanical checks (`make test`, lint, typecheck, build) are necessary but not sufficient: list them once and confirm a named target exists before citing it. A criterion must be able to fail for a reason other than the edit not applying, so do not verify by asserting the diff landed (deleted attribute absent, added clause present).

## Revision

A redirect is new input scoped to what it names. On each iteration:

- Revise the sections the feedback covers. Untouched sections stay untouched. Do not regrow the whole plan or log every decision and revision. Never re-present text unchanged after a rejection.
- Consolidate before every re-present. A superseded design collapses to a two-line pointer: what it was, why it was parked, where the artifact lives. Resolved research moves to the decisions file. A plan that argues with its earlier self has stopped being a plan.
- Lead the re-present with a short "Changed since last plan" block. The full document lives in the plan file the user reads at handoff. The re-present is for the delta.
- Treat every AskUserQuestion answer from this session as a constraint. Before ExitPlanMode, verify the plan satisfies each one.
- Question the axis, not the plan. When feedback or investigation opens an axis with more than one viable position (scope breadth, framework positioning, naming, execution shape), fire one batched AskUserQuestion before drafting into it. An unasked axis question costs full re-present cycles; one batched question is cheaper than one re-present.

## Naming and Conventions

Before naming symbols, files, directories, or headings, check what already governs them:

- Cross-module symbols drop the leading underscore. Private stays private.
- `ls` the sibling layout and match it (for skills, a `references/` subdir).
- Honor standing `CLAUDE.md` rules. Numbered `Step`/`Phase` headings are banned everywhere, plan files included.

## Pauses

A pause or bare interrupt in plan mode is a stop signal. Present and wait. Do not edit silently and re-submit.

## Carryovers

- No time estimates.
- Reference skills inline where they run ("use `pull-request:create` after committing", "load `git:conflicts` when a rebase or merge hits conflicts") rather than in a separate list.
- Document out-of-scope observations separately. Keep them out of the change.
