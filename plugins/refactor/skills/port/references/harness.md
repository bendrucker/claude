# Harness Detail

Expose an in-process checkpoint by wrapping each implementation in a small command that prints it as JSON, which the runner diffs by path. A wrapper exits with the implementation's exit code. One that prints the code to stdout turns every exit change into one digit-masked fingerprint, so exempting one exempts them all.

- **Generated inputs.** When old and new can both be called in one test process, write a property test asserting they agree on generated inputs. Its shrinking returns the smallest input that diverges. Use [Hegel](https://github.com/hegeldev) where it has a library for the language, then the ecosystem's standard: Hypothesis for Python, fast-check for TypeScript.
- **Checkpoints.** Diff intermediate stages as well as the final output: parsed input, resolved config, the built request, the emitted bytes, exit code, stderr, files written. Report the first checkpoint that differs, since the bug is in the code that produced it. An end-to-end diff alone says only that something differs.
- **Replay.** Run anything nondeterministic or side-effecting (network, clock, randomness, a model call, `gh`, the filesystem outside a temp dir) once, record it, and feed the recording to both implementations. Live calls on each side produce noise that hides real diffs. A side effect that runs twice, such as a write, a charge, or a filed to-do, is a bug in the harness.
- **Normalize** only what is meaningless by contract, such as map ordering a consumer never reads. Record each normalization in the ledger as an exemption.

## Fingerprints

Group diffs by *fingerprint*: the checkpoint, the field or byte offset, and the kind of difference (missing, extra, reordered, escaped, truncated). Many diffs that share a fingerprint are one row. A divergence early in the pipeline masks the ones after it, so expect new rows to appear as dominant ones close.

## Review

Before reporting done, read the whole diff for changes that make the harness match without making the port correct:

- A branch keyed on one input value, file name, or fixture.
- A change to the harness or its recorded replays after porting started, normalizations included.
- A test whose expected value, error type, or negative case changed.

Each one is a ledger row until a general fix or a sign-off closes it.
