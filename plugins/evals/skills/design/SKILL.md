---
name: evals:design
description: >-
  Design an eval suite for a skill, agent, prompt, or model-backed feature:
  frame what it measures, source and split cases, and write graders. Use when
  building a new suite, adding cases to one, or when a climb finds the suite
  measures the harness. To climb an artifact against a ready suite, use
  evals:hill-climb.
argument-hint: "<artifact> [<suite dir>]"
---

# Design

Goal: a suite whose score moves only when the artifact's behavior on the motivating failure moves. A climb on it then measures the artifact rather than the fixture, the grader, or the harness. The suite is done when every check in [references/suite.md](references/suite.md) holds and `evals:hill-climb` can take its first baseline.

Follow the conventions of the harness the repo already runs. The suite's own `README.md`, when one exists, outranks this document.

## Frame

Name three things before writing a case: the artifact under test, the behavior it should produce, and the evidence that motivated the suite. The evidence is a user correction, a review comment, or a production failure, quoted from where it happened. A suite with no motivating failure has no target to climb, so ask for one before going on.

Write the frame at the top of the suite's `README.md`, so every later case and grader traces back to it.

## Cases

Take cases in this order:

1. Real turns the user corrected.
2. Requests the system handled badly in production traces.
3. Bug repros that fail before the fix and pass after.
4. Variations of a real case.

Synthesize a case only as a variation of a real one. Rewrite each real turn into a fixture that keeps its shape and drops private content. Text mined from real sessions or work repos goes to the harness's private store, never into the repo.

Cover each kind of request the artifact handles. Add a quiet case, where the artifact should not fire or should change nothing, and a balance case, where it should change little. These two catch a change that over-applies the artifact.

## Split

Tag every case `dev` or `holdout`. Assign about a third to `holdout` at random within each kind of request, never by baseline score. Give both splits a case for every kind. A suite too small to spare a `holdout` case per kind skips the split and reports `dev`-only results.

## Graders

- Grade deterministically wherever a pattern decides the verdict.
- Give each judge one criterion and an explicit pass bar ("passes only when every core fact is present"). A bare score drifts between runs.
- Pair each removal grader with a survival grader for the fact that must stay, so a reply that deletes everything fails.
- Set the judge model to a model other than the one under test.
- Keep grader text, expected values, and other cases out of the fixture a session runs in.

Grade only what the prompt states or a domain expert would read into it.

## Ready

Check the suite against every item in [references/suite.md](references/suite.md): source, split, reach, balance, graders, judges, isolation, lint, scaling, noise, and headroom. Then hand off to `evals:hill-climb` for the baseline.

## Harness

Commands and file layout depend on the stack:

- [references/native.md](references/native.md) for `claude plugin eval`.
- [references/pydantic-evals.md](references/pydantic-evals.md) for a Python agent evaluated with pydantic-evals.
- [../hill-climb/references/harnesses.md](../hill-climb/references/harnesses.md) for any other harness.
