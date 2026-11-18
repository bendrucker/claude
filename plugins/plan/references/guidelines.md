# Planning Guidelines

The deliverable is one plan file with two readers. The user approves or redirects it from the file alone, since plan mode shows them nothing else. A new session then executes it with no access to this conversation. The Brief serves the user. The rest of the plan holds everything the implementer needs.

## Grounding

Most rejected plans miss something the code already contains or the request already states. Read first, and show the reading in the plan's Context:

- Cite callers and consumers by `file:line`. For a generalization, grep the call sites and state the count.
- Quote the user's explicit constraints: a stop instruction (it overrides plan mode), a "not acceptable", a required order. An issue's Open Questions are decisions to surface, not answered requirements.
- For a fix, confirm the failure against evidence (a repro, a query, the lines read) before proposing a mechanism. Check pricing, flags, and API facts at the source.
- When the code contradicts the request's premise, surface the conflict with its `file:line` and let the user resolve it.
- Show the code any proposed signature, abstraction, constant list, or storage path has to fit.

## Before Plan Mode

- Resolve open choices first. When more than one viable approach exists, ask with `AskUserQuestion` and write the plan to the answer.
- For an investigation, present the root cause as prose and let the user correct it before planning a fix.
- Write the plan yourself. Subagents return findings, not plans.
- For a vague ask ("a skill", "a few rules"), plan the smallest change that satisfies it and offer heavier work as named tiers. Ask before adding a guard, rule, or test that catches zero existing cases.

## Brief

Make `## Brief` the plan's first `##` heading. A hook checks its structure at `ExitPlanMode` and denies a plan that misses it:

- One paragraph stating the approach.
- A `Decisions:` line, then a list of at most five decisions the user would otherwise discover in the diff. Each names the choice, then `Rejected:` with the strongest alternative and its evidence as a code span or link: a `file:line`, a query, a doc.
- A `Measure:` line naming the change type and the loop from Measurement.
- On every presentation after a rejection, a `Revised:` list naming what changed in answer to the feedback.

```markdown
## Brief

Approach: move guideline delivery to a command hook so it reaches every host.

Decisions:
- Inject on UserPromptSubmit in plan mode. Rejected: the mod's reminder rewrite (`mod/register.ts:73`), which a security plugin bypasses.

Measure: infra/config → the `plan-delivery` query per host after a re-sync.
```

## New Terms

Define each term, type, or field the plan relies on at first use: name its source when it exists upstream, or say in one line what it abstracts when coined here. For one that crosses a process or repo boundary (wire field, env var, manifest key), also name its consumers. If no one-line definition works for a new reader, use plain language instead.

## Plan Shape

- After the Brief, state the non-negotiable conventions and a stop condition (implement, ship, end).
- Deferred design goes in a linked file the implementer is told not to open.
- Honor standing `CLAUDE.md` rules (numbered `Step`/`Phase` headings are banned, plan files included) and match the sibling layout when naming files and symbols.
- Reference skills inline where they run. No time estimates. List out-of-scope observations separately.

## Measurement

Pick the loop by change type:

- Deterministic code: write a failing test first, then make it pass.
- Model behavior (prompts, skills, rules, guidelines): run the eval suite, and climb with `evals:hill-climb`.
- Performance: benchmark before and after, and profile before choosing what to change.
- UI: capture screenshots before and after, and iterate against a rubric.
- Infra or config: observe the live system after the change deploys.

For each loop, state whether each metric is informational or a target, and name the artifact the loop leaves: a test file, an eval result path, benchmark output, a screenshot, a query result. Include at least one signal that fails when the change is wrong while the suite still passes:

```
- Signal: <query result, rendered string, exit code, row count>
  Observe via: <command or query>
  Pre-fix: <current value>   Pass: <expected value>   Artifact: <path or output>
```

List mechanical checks (test, lint, build) once, and confirm each named target exists. Asserting that the diff landed is not a signal.

## Critique

Before the first `ExitPlanMode`, run `plan:critique` when the plan adds a type, module, API, or dependency, or chooses between approaches. Merge its findings into the plan. The Brief states that the critique ran and lists what it changed or what you overruled.

## Checkpoints

Mark a checkpoint line with its emoji, and state the instruction in plain words so it holds without this guidance. Honor each marker when execution reaches it, including one the user adds by hand. These three are the plan's only emoji.

- `✋ Checkpoint: stop and confirm <what> before <what continues>`. Place one where a wrong assumption is expensive to unwind: after the first slice proves the approach, at an interface the rest builds on, before a one-way door. Never for mechanical fan-out. Stop there and wait for the user's read.
- `🧪 Verify: <signal> via <command> before <what continues>`. Place one after a slice the rest depends on. On a mismatch, stop and surface the gap.
- `⏰ Check in: schedule <what to look at> in your task manager for <absolute date>`, only where waiting is the point (a soak, an upstream fix). Give the item what a fresh session needs to resume, and continue past it.

## Revision

Feedback lives in this conversation, which the implementer never sees, so it has to change the file:

- Revise the sections the feedback names and leave the rest. A rejection with no feedback calls for a question, not a guess.
- Rewrite the body as if written once, and put what changed in the Brief's `Revised:` list. When implementing an approved plan, ignore its `Revised:` list.
- Treat every `AskUserQuestion` answer as a constraint and check the plan against each before `ExitPlanMode`.
- A pause or bare interrupt is a stop signal. Present and wait rather than editing and resubmitting.
