---
name: diagnosing-bugs
description: Find the cause of a reported failure by first building a command that reproduces it. Use when the user reports something broken, failing, throwing, hanging, or slower than it was, or points at a red CI, pipeline, or lint job.
argument-hint: "[<what is broken>]"
---

# Diagnosing Bugs

Diagnose the failure in `$ARGUMENTS`, or the one the user just reported.

## Reproduce

Build one command that fails on this bug. Reading and grepping to work out how to invoke the failing path is how you build it, not a detour around it.

A command that shows only that nothing crashed does not count. It has to drive the real code path and produce the symptom that was reported.

For a failing CI or pipeline job, that command already ran. Use `github:actions-monitor` or `gitlab:ci-monitor` to get the logs rather than reconstructing the job locally.

When nothing you try reaches the bug, say so and stop. Name what you tried and what each attempt could not reach, then ask for an environment where it reproduces, a captured artifact, or permission to add instrumentation.

## Find the Cause

Change one thing per run and let the command settle it. A cause the command has not responded to is a guess, and saying which line is at fault is not the same as showing the command go green when you change it.

Report one cause. When the cause is not clear, say what you ruled out and how you ruled it out, then ask rather than presenting a list to choose from.

## Hand Off

With the cause established and the fix clear, enter plan mode and map out the implementation.

When the user asked you to diagnose without changing anything, stop at the cause and the plan.

## Confirm

Once a fix is in, run the original reproduction again. Report it fixed only after that command passes, and quote the run.

A fix that was never run against the thing that failed is not a fix, and neither is one verified against a smaller case you built along the way.
