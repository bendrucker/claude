---
name: diagnosing-bugs
description: Find the cause of a reported failure by first building a command that reproduces it. Use when the user reports something broken, failing, throwing, hanging, or slower than it was, or points at a red CI, pipeline, or lint job.
argument-hint: "[<what is broken>]"
---

# Diagnosing Bugs

Diagnose the failure in `$ARGUMENTS`, or the one the user just reported.

## Reproduce

Build one command that fails on this bug: it drives the real code path and produces the reported symptom. Read and grep as needed to find how to invoke that path.

For a failing CI or pipeline job, that command already ran. Get its logs with `github:actions-monitor` or `gitlab:ci-monitor`.

When nothing you try reaches the bug, stop. Name what you tried and what each attempt could not reach, then ask for an environment where it reproduces, a captured artifact, or permission to add instrumentation.

## Find the Cause

Change one thing per run. A cause is established when changing it turns the command green.

Report one cause. When none is established, say what you ruled out and how, then ask.

## Hand Off

With the cause established and the fix clear, enter plan mode and map out the implementation. When the user asked for diagnosis without changes, stop at the cause and the plan.

## Confirm

Once a fix is in, re-run the original reproduction, not a smaller case built along the way. Report it fixed only after that command passes, and quote the run.
