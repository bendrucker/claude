# Replacing Homegrown Code With a Library

Use this when the new implementation is the standard library or a maintained package and the old one is code the project wrote itself. Generated code reinvents solved problems readily. The reinvention handles the inputs its author pictured and fails on the rest of the spec.

## Copies

When the same hand-roll appears in several files, replace every copy rather than consolidating them first: once each copy calls the library, nothing is left to share. To search a repository for candidates, use the `candidates` skill.

## Decide

Replace when the code implements a format or protocol with a spec (CSV, YAML, semver, shell quoting, URLs), escapes or encodes anything that reaches a shell, regex, HTML, or SQL, coordinates concurrency, retries, or timeouts, or has already needed fixes for inputs nobody anticipated.

Keep the homegrown code, and say why, when it is a total function over a small input domain the code fully controls, when the project bars new dependencies in that location, or when the closest library's semantics fit worse than the code it replaces.

Pick the replacement in this order:

1. The language's standard library, at the project's minimum supported version.
2. A runtime builtin the project already targets, such as Bun or Deno APIs.
3. A package already in the lockfile.
4. A new, maintained package. Check recent releases, open security advisories, license, and transitive dependency count.

## Oracle

The harness still runs both implementations, but a disagreement usually marks a bug in the homegrown code, because the library follows the spec. Classify each ledger row:

- **Homegrown bug.** The library follows the spec and the old code did not. Callers see a change. The row needs the user's sign-off like any intended change.
- **Relied-on quirk.** A caller depends on the old behavior. Reproduce it in a thin wrapper around the library, named for what callers need, and record why.

## Replace

Delete the homegrown implementation and the tests that exercised its internals. Keep the tests that call it through its callers, and run them against the library. Add the dependency through the package manager with the repository's pinning convention. The replacement is done when a search for the homegrown implementation comes back empty and the port's own completion criteria hold.
