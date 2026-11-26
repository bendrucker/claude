---
name: port
description: Replace an implementation with a new one that must behave the same, such as a rewrite in another language, a script converted to TypeScript, a hook moved to a mod, or a library or engine swapped underneath an unchanged interface. Use when porting, converting, reimplementing, or migrating code where existing callers must not see a difference.
argument-hint: "[<what is being ported>]"
---

# Port

Port `$ARGUMENTS`, or the implementation the user named, so that every caller sees the same behavior from the new code as from the old. The old implementation is the *oracle*: while both exist, the old code defines correct, ahead of the spec, the docs, and the test suite.

A ported test suite is a weak signal. It was written against the old implementation's internals. It often runs green while real inputs diverge. Treat green tests as necessary, never as proof of parity.

## Differential Harness

Build the harness before porting. It runs old and new on the same input and diffs the results. Every later step reports against it.

- **Inputs.** Draw them from real use first: logged invocations, fixture repos, recorded payloads, shell history. Add generated inputs for the edges real use rarely reaches. Count matches over real inputs, since a hand-picked set inflates the match rate.
- **Checkpoints.** Diff intermediate stages as well as the final output: parsed input, resolved config, the built request, the emitted bytes, exit code, stderr, files written. Report the first checkpoint that differs, since the bug is in the code that produced it. An end-to-end diff alone says only that something differs.
- **Replay.** Run anything nondeterministic or side-effecting (network, clock, randomness, a model call, `gh`, the filesystem outside a temp dir) once, record it, and feed the recording to both implementations. Live calls on each side produce noise that hides real diffs. A side effect that runs twice, such as a write, a charge, or a filed to-do, is a bug in the harness.
- **Normalize** only what is meaningless by contract, such as map ordering a consumer never reads. Record each normalization in the ledger as an exemption.

## Ledger

Keep a ledger of divergences in the working tree, one row per distinct bug. Group diffs by *fingerprint*: the checkpoint, the field or byte offset, and the kind of difference (missing, extra, reordered, escaped, truncated). Many diffs that share a fingerprint are one row.

Work the row covering the most inputs first. A divergence early in the pipeline masks the ones after it, so expect new rows to appear as dominant ones close.

Classify each row as a bug or an intended change. An intended change needs the user's sign-off, then becomes an exemption the harness skips and the PR body lists. Absent sign-off, the row is a bug.

## Porting Rules

- When the old behavior is unclear, read the old code and port what it does. A guess at intent is a bug the harness has not caught yet. After correcting one guess, search for others made the same way.
- Port the quirks: error text, exit codes, empty-input handling, escaping, ordering, trailing newlines. Callers depend on behavior nobody documented.
- Fix each row in the general code path. A special case that makes one input match leaves the general path wrong. It passes the harness and fails the next input. Close the row only with a general fix.
- When a test fails on the new code, fix the code. When a ported test must change, keep its assertion as strong as the original's (see the Ports section in the testing rule).
- When the old implementation keeps changing during the port, re-run the harness against its latest version. A match against a stale oracle is meaningless.

## Done

The port is done when:

- Every row in the ledger is closed or is a signed-off exemption.
- The harness matches on every real input gathered, with the match rate and input count reported.
- The ported tests pass with assertions no weaker than the originals.

Report those numbers and the exemption list in the PR body. Keep the old implementation and the harness until the user approves cutover, then delete both in the cutover change.

For a production service with live traffic, private payloads, or a long dual-run period, read [references/production.md](references/production.md).
