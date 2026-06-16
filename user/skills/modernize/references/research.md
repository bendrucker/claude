# Researching what's new in the gap

The risk here is confident wrongness. "Added in 3.10" from memory, off by a version, and the candidate is invalid or breaks the floor. Ground every "new in version X" claim in a dated, official source before it earns a place in the survey.

## Research targets

For the language and each major dependency, read the changelog across the gap, floor to current. Look for two things.

- **Additions.** Features that did not exist at the floor and now do. These are adoption candidates.
- **Deprecations and replacements.** Old APIs the project may use that are now discouraged, and what replaced them. These are often the highest-value candidates, because the old path is on a clock.

## Sourcing rules

- Prefer the official changelog, release notes, or "what's new" page over blog posts and forum answers. Note the version each feature landed in.
- A feature is adopt-now only if it landed at or below the floor. If it landed above, it is a flagged bump. Record the exact minimum version it needs.
- For each candidate feature, capture one source URL and the introducing version. The survey cites them so the user can verify without re-researching.
- When availability is version-sensitive and you cannot find a dated source, leave the feature out. Omission beats a wrong floor claim.

## Codemods and migration guides

Many ecosystems ship tools that perform a modernization mechanically and preserve semantics. Finding one turns a risky hand-edit into a reviewable, repeatable command. Look for these during research and note them on the relevant candidates.

- JS/TS: framework codemod CLIs (React, Next, Vue), `eslint --fix` with modern rule sets, `ts-migrate`.
- Python: `pyupgrade`, `ruff` autofixes, library-provided `2to3`-style tools.
- Go: `gofmt -r` rewrite rules, `go fix`, vendored API migration tools.
- Rust: `cargo fix --edition`, `cargo clippy --fix`.
- Java/Kotlin: OpenRewrite recipes, IDE migration inspections.

A migration guide from the dependency's maintainers is the authoritative map for the dependency axis. Read it before proposing framework-API candidates. It lists the exact old-to-new mappings and the version each requires.

## Stdlib subsumption

Check whether any major dependency has been absorbed into the language or runtime within the gap. The changelog phrasing is usually "now built in," or a new stdlib module matching a popular package's job. The candidate is to remove the dependency and replace it with the native equivalent. Flag it as high leverage and confirm the native version's floor.

The canonical example is Go's `golang.org/x/exp/slices` and `golang.org/x/exp/maps`, promoted to the stdlib `slices` and `maps` packages in Go 1.21. A project on Go 1.21+ that still imports the `x/exp` versions can drop the dependency and switch the import path, often with no other change. Equivalents recur everywhere: a left-pad helper replaced by a string method, a UUID package replaced by a stdlib generator, a fetch polyfill replaced by the native global. The shape is always the same. Less code, one fewer dependency.
