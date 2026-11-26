---
name: upstream
description: Replace homegrown code with the standard library or a maintained package, such as a hand-rolled parser, escaper, retry loop, arg parser, or formatter that generated code reinvented. Use when replacing custom code with a library, adopting a stdlib feature, or when a hand-written implementation of a solved problem keeps breaking.
argument-hint: "[<the homegrown code>]"
---

# Upstream

Replace `$ARGUMENTS`, or the homegrown code the user named, with an implementation someone else maintains and has tested against inputs this codebase never saw. Generated code reinvents solved problems readily. The reinvention handles the inputs its author pictured and fails on the rest of the spec.

Swapping one maintained library for another is a [port](../port/SKILL.md), with the old library as the oracle. Run this skill only when the code being replaced is homegrown.

## Find Candidates

When asked to look for candidates rather than replace a named one, search for hand-written versions of the patterns in [references/patterns.md](references/patterns.md). Count the copies of each. A pattern copied into several files is a stronger candidate than one copy. Replace every copy here rather than consolidating them first: once each copy calls the library, nothing is left to share.

## Decide

Replace when the code implements a format or protocol with a spec (CSV, YAML, semver, shell quoting, URLs), escapes or encodes anything that reaches a shell, regex, HTML, or SQL, coordinates concurrency, retries, or timeouts, or has already needed fixes for inputs nobody anticipated.

Keep the homegrown code, and say why, when it is a total function over a small input domain the code fully controls, when the project bars new dependencies in that location, or when the closest library's semantics fit worse than the code it replaces.

Pick the replacement in this order:

1. The language's standard library, at the project's minimum supported version.
2. A runtime builtin the project already targets, such as Bun or Deno APIs.
3. A package already in the lockfile.
4. A new, maintained package. Check recent releases, open security advisories, license, and transitive dependency count. Load `research:prior-art` for a comparison when several packages fit.

## Parity

Build the differential harness from [port](../port/SKILL.md), with the homegrown code and the replacement as columns. Here the library is the *oracle*, because it follows the spec. A disagreement usually marks a bug in the homegrown code.

Classify each ledger row:

- **Homegrown bug.** The replacement follows the spec and the old code did not. Callers see a change, so list it for the user's sign-off.
- **Relied-on quirk.** A caller depends on the old behavior. Reproduce it in a thin wrapper around the library, named for what callers need, and record why.

## Replace

Past about five call sites or copies, replace one to three by hand and follow [port's scale method](../port/references/scale.md) for the rest.

Delete the homegrown implementation and the tests that exercised its internals. Keep the tests that call it through its callers, and run them against the replacement. Add the dependency through the package manager with the repository's pinning convention.

## Done

The replacement is done when:

- A search for the homegrown implementation comes back empty.
- Every harness disagreement is a signed-off homegrown bug or a wrapped quirk, and the PR body lists each.
- The caller-level tests run green against the replacement.
