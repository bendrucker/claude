# Researching what's new in the gap

The risk here is confident wrongness: "this was added in 3.10" from memory, off by a version, and the whole candidate is invalid or breaks the floor. Ground every "new in version X" claim in a dated, official source before it earns a place in the survey.

## What to research

For the language and each major dependency, the changelog across the gap (floor → current). You are looking for two things:

- **Additions** — features that did not exist at the floor and now do. These are adoption candidates.
- **Deprecations and replacements** — old APIs the project may use that are now discouraged, and what replaced them. These are often the highest-value candidates because the old path is on a clock.

## Sourcing rules

- Prefer the **official changelog, release notes, or "What's new in X"** page over blog posts and Stack Overflow. Note the version each feature landed in.
- A feature is only adopt-now if it landed **at or below the floor**. If it landed above the floor, it is a flagged bump — record the exact minimum version it needs.
- For each candidate feature, capture one source URL and the introducing version. The survey cites them so the user can verify without re-researching.
- When a feature's availability is version-sensitive and you cannot find a dated source, do not include it. Omission beats a wrong floor claim.

## Prefer official codemods and migration guides

Many ecosystems ship tools that perform a modernization mechanically and semantics-preservingly. Finding one turns a risky hand-edit into a reviewable, repeatable command. Look for these during research and note them on the relevant candidates:

- JS/TS: framework codemods (e.g. React/Next/Vue codemod CLIs), `eslint --fix` with modern rule sets, `ts-migrate`.
- Python: `pyupgrade`, `ruff` autofixes, library-provided `2to3`-style tools.
- Go: `gofmt -r` rewrite rules, `go fix`, vendored API migration tools.
- Rust: `cargo fix --edition`, `cargo clippy --fix`.
- Java/Kotlin: OpenRewrite recipes, IDE migration inspections.

A migration guide published by the dependency's maintainers is the authoritative map for the dependency axis. Read it before proposing framework-API candidates — it lists the exact old→new mappings and the version each requires.

## Stdlib subsumption

Specifically check whether any major dependency has been absorbed into the language or runtime within the gap. The changelog phrasing is usually "now built in" or a new global/stdlib module matching a popular package's job. When found, the candidate is "remove dependency D, replace with native N" — flag it as high leverage and confirm the native version's floor.
