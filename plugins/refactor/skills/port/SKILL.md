---
name: port
description: Move code to a new implementation that must behave the same, such as a rewrite in another language, a handwritten class ported to a framework's interface, a library or engine swapped out, homegrown code replaced with the standard library or a maintained package, duplicate copies merged into one, or a script converted to TypeScript. Use when porting, converting, reimplementing, migrating, or deduplicating code (not a database schema) where existing callers must not see a difference, and when looking for hand-rolled code a library should replace.
argument-hint: "[<what is being ported>]"
---

# Port

Port `$ARGUMENTS`, or the implementation the user named, so that every caller sees the same behavior from the new code as from the old. The old implementation is the *oracle*: while both exist, the old code defines correct, ahead of the spec, the docs, and the test suite.

A ported test suite is a weak signal. It was written against the old implementation's internals. It often runs green while real inputs diverge. Treat green tests as necessary, never as proof of parity.

## Differential Harness

Build the harness before porting. It runs old and new on the same input and diffs the results. Every later step reports against it.

- **Inputs.** Draw them from real use first: logged invocations, fixture repos, recorded payloads, shell history. Add generated inputs for the edges real use rarely reaches. Count matches over real inputs, since a hand-picked set inflates the match rate. With no record of real use, mine the repository's callers, tests, and docs for the arguments they pass, generate the rest from the format's grammar, and report which set the match rate counts.
- **Generated inputs.** When old and new can both be called in one test process, write a property test asserting they agree on generated inputs. Its shrinking returns the smallest input that diverges. Use [Hegel](https://github.com/hegeldev) where it has a library for the language, then the ecosystem's standard: Hypothesis for Python, fast-check for TypeScript.
- **Checkpoints.** Diff intermediate stages as well as the final output: parsed input, resolved config, the built request, the emitted bytes, exit code, stderr, files written. Report the first checkpoint that differs, since the bug is in the code that produced it. An end-to-end diff alone says only that something differs.
- **Replay.** Run anything nondeterministic or side-effecting (network, clock, randomness, a model call, `gh`, the filesystem outside a temp dir) once, record it, and feed the recording to both implementations. Live calls on each side produce noise that hides real diffs. A side effect that runs twice, such as a write, a charge, or a filed to-do, is a bug in the harness.
- **Normalize** only what is meaningless by contract, such as map ordering a consumer never reads. Record each normalization in the ledger as an exemption.

## Ledger

Keep a ledger of divergences in a file, such as `tmp/<task>/ledger.md`, one row per distinct bug, with the fingerprint, the inputs it covers, the first checkpoint that differs, and its status: open, fixed with the commit, or exempt with who signed off. A later session resumes from the file. Group diffs by *fingerprint*: the checkpoint, the field or byte offset, and the kind of difference (missing, extra, reordered, escaped, truncated). Many diffs that share a fingerprint are one row.

Work the row covering the most inputs first. A divergence early in the pipeline masks the ones after it, so expect new rows to appear as dominant ones close.

Classify each row as a bug or an intended change. An intended change needs the user's sign-off, then becomes an exemption the harness skips and the PR body lists. Absent sign-off, the row is a bug. With nobody present to sign off, mark the row proposed, finish the other rows, and lead the report with the proposals.

## Porting Rules

- When the old behavior is unclear, read the old code and port what it does. A guess at intent is a bug the harness has not caught yet. After correcting one guess, search for others made the same way.
- Port the quirks: error text, exit codes, empty-input handling, escaping, ordering, trailing newlines. Callers depend on behavior nobody documented.
- Fix each row in the general code path. A special case that makes one input match leaves the general path wrong. It passes the harness and fails the next input. Close the row only with a general fix.
- When a test fails on the new code, fix the code. When a ported test must change, keep its assertion as strong as the original's: the same expected values, error types and messages, and negative cases.
- When the old implementation keeps changing during the port, re-run the harness against its latest version. A match against a stale oracle is meaningless.

## Adopting an Interface

When the target is an interface someone else defines, such as a framework's store or client protocol, the interface sets the method signatures and the old implementation still sets the behavior callers rely on.

- Compare at the callers. Run the harness on what callers observe through their existing entry points, with old and new behind them.
- List every place the interface's contract differs from what callers rely on: sync versus async, ordering, what a limit or page counts, identity and timestamps, missing-key and error behavior, transaction scope, and the format of data already persisted. Each one is a ledger row before any code changes.
- Settle each row one of three ways: the new implementation reproduces the old behavior inside the interface, a caller-side adapter restores it, or the user signs off on the change. Report which, row by row.
- Treat data the old implementation already wrote as real input. The new implementation reads the existing files or rows, and the harness compares what callers get back.
- Move callers over one at a time, re-running the harness after each.

## Review

Before reporting done, read the whole diff for changes that make the harness match without making the port correct:

- A branch keyed on one input value, file name, or fixture.
- A change to the harness or its recorded replays after porting started, normalizations included.
- A test whose expected value, error type, or negative case changed.

Each one is a ledger row until a general fix or a sign-off closes it.

## Done

The port is done when:

- Every row in the ledger is closed or is a signed-off exemption.
- The harness matches on every real input gathered, with the match rate and input count reported.
- The ported tests pass with assertions no weaker than the originals.

Report those numbers and the exemption list in the PR body. Keep the old implementation and the harness until the user approves cutover, then delete both in the cutover change.

When the new implementation is a library replacing code the project wrote itself, or when asked to find such code, read [references/upstream.md](references/upstream.md).

When several copies of the same logic become one shared version, read [references/dedupe.md](references/dedupe.md).

When the port repeats across many units, such as scripts, call sites, or modules, read [references/scale.md](references/scale.md) before the second unit.

For a production service with live traffic, private payloads, or a long dual-run period, read [references/production.md](references/production.md).
