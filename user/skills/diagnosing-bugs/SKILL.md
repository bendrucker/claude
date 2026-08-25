---
name: diagnosing-bugs
description: Diagnose a known bug or performance regression by building a command that reproduces it before forming any theory. Use when something is broken, throwing, failing, hanging, corrupting data, or slower than it was, when a test fails for reasons nobody understands, or when the user says debug this, diagnose this, or asks why something is happening.
argument-hint: "[<what is broken>]"
---

# Diagnosing Bugs

Diagnose the bug in `$ARGUMENTS`, or the failure the user just reported. Work the sections below in the order they appear, by whatever route reaches each done-state. Feedback Loop is not skippable, and skipping a later section means naming the done-state you are claiming without it.

## Redact

Replace every secret with `<REDACTED>` before showing a command, its output, or a captured artifact. Quote only the signal-carrying lines of a captured trace.

When redaction removes what you need to diagnose the bug, say so and ask the user.

## Feedback Loop

Goal: one command that goes **red** on this bug.

A loop is **red** when it drives the real code path and asserts the user's exact symptom. A command that checks only that nothing crashed is not red. A loop is **tight** when it is fast, deterministic, and runnable unattended.

Build the loop before reading code to explain it.

Read [references/loops.md](references/loops.md) to pick a rung from the ladder, or when the loop you built is slow, flaky, or impossible to construct.

Done when you can name one command, have run it at least once, and have shown the invocation and its redacted output going red on this bug.

## Reproduction

Goal: the smallest scenario that still goes red.

Run the loop. Confirm the failure it produces is the one the user described rather than a nearby one, and that the verdict repeats across runs. When it does not, raise and record a reproduction rate before continuing. Capture the exact symptom: error text, wrong value, measured timing.

Then cut the scenario down: inputs, callers, config, data, and steps, one at a time, re-running the loop after each cut. Keep a cut that leaves the loop red. Revert a cut that stops the failure.

Done when every remaining element is required.

## Hypotheses

Goal: a ranked set of falsifiable causes, written before any of them is tested.

Write three to five hypotheses. Each states a prediction the loop can settle: if X is the cause, changing Y stops the loop failing, or changing Z raises the failure rate. Sharpen or drop a hypothesis that states no prediction.

Show the ranked list to the user before testing. Proceed on your own ranking when they do not answer.

## Instrumentation

Goal: every hypothesis settled by a run of the loop.

Change one variable per run. Aim each probe at a specific prediction.

Use a debugger or REPL where the runtime supports one. Otherwise log where the hypotheses predict different values. Tag every debug log with a unique prefix such as `[DEBUG-a4f2]`.

For a performance regression, measure rather than log. Establish a baseline with a timing harness, a profiler run, or a query plan, then bisect against it.

Done when every hypothesis is marked eliminated or surviving, each by a named run of the loop. When none survives, return to Hypotheses with what these runs ruled out.

## Fix and Regression Test

Goal: a fix the loop proves, and a test at a seam that catches the bug returning.

Find the seam first. A correct seam exercises the real pattern the bug takes at the call site. A single-caller test for a bug that needs two callers is too shallow.

Report a missing seam as a finding about the module's shape, and continue. Name the module and the part of its interface that blocks the test.

With a seam: turn the minimized scenario into a test there, watch it fail, apply the fix, watch it pass. Then re-run the loop against the original, pre-minimization scenario.

Done when the regression test fails without the fix and passes with it, and the original scenario no longer reproduces under the loop. A missing seam substitutes for the test only when the report names it.

## Cleanup

Done when all of these hold:

- Re-running the loop after cleanup still fails to reproduce the original scenario.
- The regression test passes, or the report names the seam that does not exist.
- A grep for the debug prefix returns nothing.
- No throwaway harness remains outside a path with `debug` in its name.
- The commit or PR message states which hypothesis was correct.
