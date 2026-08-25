# Feedback Loops

## The Ladder

Pick the cheapest rung that reaches the bug.

1. **Failing test** at the seam the bad value crosses.
2. **HTTP request** scripted with `curl`, when a running dev server reaches the bug.
3. **CLI invocation** on a fixture input, diffed against a known-good snapshot.
4. **Headless browser script** when the symptom appears only through the UI.
5. **Trace replay** when a real request, payload, or event log can be captured and fed back through the code path.
6. **Throwaway harness** when the bug needs a subset of the system standing and the rest faked.
7. **Property or fuzz loop** when the symptom is wrong output on some inputs.
8. **Bisection harness** when the bug appeared between two known states: commits, dataset versions, dependency versions.
9. **Differential loop** against a known-good adapter, when a previous version or a second implementation produces the right output.
10. **Human-in-the-loop script** when a person has to click. Start from [../scripts/hitl-loop.template.sh](../scripts/hitl-loop.template.sh).

## Tightening

- Faster: cache setup, skip initialization the bug does not touch, narrow the test to the failing case.
- Deterministic: pin the clock, seed the RNG, isolate the filesystem, block the network.
- Unattended: replace a manual step with a fixture, a stub, or a scripted click.

Stop when the verdict arrives in seconds and two runs on one input never disagree.

## Intermittent Bugs

Raise the reproduction rate until a fix is distinguishable from noise: loop the trigger a hundred times, run copies in parallel, add load, narrow the timing window, or inject sleeps at the point where the ordering matters. Record the rate you reach as the threshold later runs are compared against.

## When No Loop Is Possible

Say so directly and stop. List every rung you tried and what part of the bug it could not reach. Then ask the user for one of these, and wait:

- Access to an environment where the bug reproduces.
- A redacted artifact captured while it happened: HAR file, log dump, core dump, or screen recording with timestamps.
- Permission to add temporary instrumentation where it happens.
