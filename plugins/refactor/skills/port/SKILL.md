---
name: port
description: Load before changing code in any port, migration, or cutover, even when the request never says "port", and whenever an existing script, service, or module is being retired, deleted, or switched off because a newer implementation now does its job, in any language. That covers rewriting code in another language or as TypeScript, switching code from one library, engine, or module to another, implementing a framework's interface in place of a handwritten class, replacing homegrown code with the standard library or a package, merging duplicate copies, and finishing a port or cutting callers over to it. Inputs and callers that worked before must keep working. Not for a deliberate behavior change such as a bug fix or a new option, and not for a database schema.
argument-hint: "[<what is being ported>]"
---

# Port

Port `$ARGUMENTS`, or the implementation the user named, so that every caller sees the same behavior from the new code as from the old. The old implementation is the *oracle*: while both exist, the old code defines correct, ahead of the spec, the docs, and the test suite. A ported test suite often runs green while real inputs diverge, so treat green tests as necessary, never as proof of parity.

## Inputs Come From Callers

Before porting, find every caller and gather the inputs they pass: scripts, cron and CI jobs, the README and docs, config files the code reads, tests, and logged invocations. A caller outside the files being edited breaks only at cutover. Count the match rate over these real inputs, and report which set it counts.

## Differential Harness

Run old and new on the same inputs and diff the results before declaring done. When both run as commands over input files, use the bundled runner:

```sh
bun ${CLAUDE_PLUGIN_ROOT}/skills/port/scripts/diff-run.ts --old '<old command> {}' --new '<new command> {}' --out tmp/<task> <inputs...>
```

It compares exit code, then stdout, then stderr, and writes `ledger.json` and `ledger.md` under `--out`. `{}` becomes the quoted input path, or pass `--stdin`. `--normalize <regex>` masks a field in both outputs, and each normalization is an exemption. Record nondeterministic or side-effecting calls once and replay them to both sides. For checkpoints, generated inputs, wrappers, fingerprints, and a pre-merge review, read [references/harness.md](references/harness.md).

## Ledger

Keep one row per distinct divergence in the ledger file, with its inputs and status: open, fixed, or exempt with who signed off. An intended change needs the user's sign-off. With nobody present to sign off, mark the row proposed, finish the other rows, and lead the report with the proposals. Fix each row in the general code path, never with a special case for one input.

## Done

The port is done when every ledger row is closed or signed off and the harness matches on every real input gathered. Report the match rate, input count, and exemptions in the PR body. Keep the old implementation and the harness until the user approves cutover, then delete both in the cutover change.

When the target is an interface someone else defines, such as a framework's store or client protocol, read [references/interface.md](references/interface.md).

When the new implementation is a library replacing code the project wrote itself, read [references/upstream.md](references/upstream.md).

When several copies of the same logic become one shared version, read [references/dedupe.md](references/dedupe.md).

When the port repeats across many units, such as scripts, call sites, or modules, read [references/scale.md](references/scale.md) before the second unit.

For a production service with live traffic, private payloads, or a long dual-run period, read [references/production.md](references/production.md).
