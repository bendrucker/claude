# Planning Guidelines

The deliverable is one plan file a fresh context can implement. Presenting it ends this session's job: the plan is handed to a session with no transcript, no research, and no memory of what was ruled out. It will not be revised interactively. Everything the implementer needs is in the file, and nothing in the file is there for the reader who was here.

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

## Direction Before Detail

Settle the approach before the file exists, not by presenting a thin plan and waiting for a redirect. When more than one viable approach is live, fire an `AskUserQuestion` and write into the answer. A plan presented to elicit direction spends the presentation on a question one `AskUserQuestion` answers first, and what comes back is a rewrite rather than an edit.

## New Terms

When the plan introduces a term, type, field, or abstraction it then relies on, define it on first use and say where it comes from:

- From an established source: name the source (the OTel call, the DuckDB catalog function, the existing machinery it models). Naming the source forces the check of whether something upstream already covers it.
- Coined here: state in one line what it abstracts.

Inline on first use is enough. A separate definitions section is optional. Two rules hold either way:

- For a term that crosses a process or repo boundary (a wire field, manifest key, env var, step name, marker convention), also name its consumers and any open question.
- If you cannot write a one-line definition a reader new to this session would understand, cut the term and use plain language.

Defer naming to implementation when the deliverable is not the code itself (an issue, a design doc). Do not anchor the plan on a coined type, exception, or module name.

## Plan Shape

The plan is a do-now spec for a session that reads nothing else:

- Open with the non-negotiable conventions and a stop condition (implement, ship, end). Without a stop condition, the implementing session absorbs the next job too.
- Stamp the plan with the commit it was written against (`**Planned at**: commit <short SHA>, <date>`) and make the executor's first instruction a drift check: `git diff --stat <SHA>..HEAD -- <the plan's in-scope paths>`. A `⏰` check-in fires days later against a repo that has moved, and the file records nothing else about what it was true of. When a listed path has changed, compare the plan's excerpts against the live code before executing, and treat a mismatch as an assumption stop.
- Deferred design goes to a separate linked file the implementer is told not to open, with one pointer line in the plan. A handoff plan heavy with deferred design forces the implementing session to re-plan work the original session never resolved.
- Resolved decisions and research synthesis move to a companion `<plan>-decisions.md` that the plan links.
- Keep plans focused and under roughly 10k characters. Past that, plans get rejected: split the scope or consolidate before presenting.

## Assumption Stops

The stop condition above bounds the job. This section bounds the plan's accuracy. It lists the assumptions whose falsification means the plan no longer describes the repo. An implementer that hits one reports back instead of improvising a change nobody approved.

Each entry names something this plan's own reading could have gotten wrong: an excerpt that no longer matches, a call-site count that has changed, a fix that turns out to need a file the plan never listed, a decision resting on a premise the code could contradict. Each ends in a stop instruction. A condition that would read identically in any other plan ("if tests fail", "if something is unclear") lists nothing. Where a repeated verification failure is the risk here, name the verification and the attempt count that ends it. When nothing in the plan rests on an assumption that could be wrong, omit the section.

## Verification

Aim for at least one criterion that fails when the change is wrong while the suite still passes. The shape:

```
- Signal: <observable: query result, rendered string, exit code, span attribute, row count>
  Observe via: <command or query>
  Pre-fix: <current value>   Pass: <expected value>
```

Without the before/after contrast, a criterion only restates intent. Mechanical checks (`make test`, lint, typecheck, build) are necessary but not sufficient: list them once and confirm a named target exists before citing it. A criterion must be able to fail for a reason other than the edit not applying, so do not verify by asserting the diff landed (deleted attribute absent, added clause present).

Layer verification through the plan. A criterion parked only at the end catches the break after the whole plan is built, not at the slice that caused it. Where a slice must hold before the next builds on it, place a `🧪` verification checkpoint at the proving point (see `Checkpoints`).

## Revision

A redirect is new input scoped to what it names. Rework the file toward the standalone test above rather than patching the text that was presented. A re-present carrying the rejected plan nearly intact has absorbed nothing: the feedback lives in this conversation, and the conversation does not travel with the file. Every rule below is that test applied.

- Revise the sections the feedback covers. Untouched sections stay untouched. If a rejection arrives with no feedback, ask what to change instead of guessing at a revision.
- When feedback supersedes a decision, delete the superseded text. Do not write around it, soften it, or annotate it.
- Cut any content whose reader is the user in this conversation rather than the implementer in a fresh session: research residue, decision narration, restated feedback. Resolved research moves to `<plan>-decisions.md`.
- A finished plan reads as if it were written once. Any sentence that only makes sense to a reader who saw an earlier draft ("changed since last plan", "previously considered", "now uses") is diary. The chat holds the history and the plan links the transcript.
- A ruled-out approach survives only when the implementer would otherwise re-propose it: one line under `## Alternatives`, the approach and why it loses. Everything else is deleted, not parked.
- Treat every AskUserQuestion answer from this session as a constraint. Before ExitPlanMode, verify the plan satisfies each one.
- Question the axis, not the plan. When feedback or investigation opens an axis with more than one viable position (scope breadth, framework positioning, naming, execution shape), fire one batched AskUserQuestion before drafting into it. An unasked axis question costs full re-present cycles; one batched question is cheaper than one re-present.

## Naming and Conventions

Before naming symbols, files, directories, or headings, check what already governs them:

- Cross-module symbols drop the leading underscore. Private stays private.
- `ls` the sibling layout and match it (for skills, a `references/` subdir).
- Honor standing `CLAUDE.md` rules. Numbered `Step`/`Phase` headings are banned everywhere, plan files included.

## Checkpoints

A checkpoint is a line the plan marks with an emoji. Three kinds, each with its own marker and discipline:

- `✋` a human checkpoint: hand back for a read.
- `🧪` a verification checkpoint: run a named check and confirm its signal.
- `⏰` a check-in checkpoint: schedule a future look at work that needs time to prove out.

Every marker is load-bearing in both directions, not decoration. When execution reaches a marked line it honors the marker before continuing past. Because each line states its instruction in plain words, a session that executes the plan without this guidance in context still honors it. The user may add a marker by hand, including on a line the plan did not mark, to insert a checkpoint the plan missed. A hand-added checkpoint is honored exactly like an authored one. These emoji are the only ones the plan carries. Add a new marker type only by defining its discipline here first.

### `✋` Human Checkpoints

When the approach carries uncertainty that convergence cannot settle in advance because only building resolves it, build in points where the plan hands back for a look before it runs on. This is not a license to skip convergence: settle everything you can before plan mode, then checkpoint what only building can. A plan that sequences every slice with no return point commits the user to an approach they cannot correct until it is all built, which is where an unsettled approach goes off the rails.

- Place a checkpoint where a wrong assumption is expensive to unwind: after the first vertical slice proves the approach, at an interface or schema the rest builds on, before a one-way door (a migration, a public rename, a destructive or outward-facing step).
- Do not checkpoint mechanical fan-out (one pattern across many files, a rename across call sites). Reserve checkpoints for decisions, not volume.

Write each as a visible stop instruction: `✋ Checkpoint: stop and confirm <what> before <what continues>`. When execution reaches the line, stop there. Present what is built and wait for the user's read before continuing past it, the same stop discipline as `Pauses`.

### `🧪` Verification Checkpoints

Do not defer every check to the end. When a slice must hold before the next is built on top of it, mark the point where it is proven, so a broken assumption surfaces at the slice that introduced it rather than after the whole plan is built.

- Place one after a slice whose correctness the rest depends on: a schema the later slices read, a parser the pipeline feeds, a migration the next step assumes has run.
- Write each as a runnable check naming its signal, the same before/after shape as `Verification`: `🧪 Verify: <signal> via <command> before <what continues>`.
- When execution reaches the line, run the check. If the signal matches, continue. If it does not, stop and surface the gap instead of building on it.

### `⏰` Check-in Checkpoints

Some outcomes cannot be known by the time execution ends because they need elapsed time. Mark the point where the work is done but unproven and schedule the look, so the intent does not die with the session.

- Place one only where waiting is the point: a rollout soaking under real traffic, a migration settling, an upstream fix landing. If the check can run now, it is a `🧪`.
- Write each as `⏰ Check in: schedule <what to look at> in your task manager for <absolute date>`. The date is when to look again, not an estimate of how long the work takes. Execution creates the item at that line and continues past without stopping.
- Give the scheduled item what a fresh session needs to re-enter: where the work lives and how to resume it. It fires with none of this context.

## Pauses

A pause or bare interrupt in plan mode is a stop signal. Present and wait. Do not edit silently and re-submit.

## Carryovers

- No time estimates. A `⏰` check-in date is not one (see `Checkpoints`).
- Reference skills inline where they run ("use `pull-request:create` after committing", "load `git:conflicts` when a rebase or merge hits conflicts") rather than in a separate list.
- Document out-of-scope observations separately. Keep them out of the change.
