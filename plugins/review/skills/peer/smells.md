# Code Smells

Treat every smell as a judgment call. Flag it where it hurts readability or maintainability, and weigh it against the project's own conventions. Never spend a comment on something a linter or type-checker already enforces. File a lint issue instead (see [priorities.md](priorities.md)) and set severity per [tone.md](tone.md) (`Nit:` for isolated cases, escalate when the smell recurs or the risk is real).

This catalog is the smells I flag most often. Each is `smell → fix`.

## The Catalog

- **Diff bloat** - the change carries more code than the goal needs, or a file is turning into a dumping ground → cut to the tightest version that still does the job, and split a file that has started accreting unrelated responsibilities.
- **Duplicated code** - the same logic repeated, or reinventing something the codebase or a dependency already provides → extract a shared function or type, or generalize to all cases instead of copying per case.
- **Comment slop** - comments that narrate what the code already says, or session narration left behind → delete them. Comment only what is not self-evident to another reader.
- **Over-specific coupling** - code hardwired to the one case that prompted it, or a dependency's name leaking across a boundary (a `gitlab`-named flag in a plugin that is not GitLab) → parameterize the concrete case, and keep the dependency's vocabulary out of the generic seam.
- **Stringly-typed** - a primitive or bare string standing in for a domain concept, or data described without types → give it a real type.
- **Data clumps** - the same group of fields or params traveling together (auth params threaded through every call) → bundle them so they pass once.
- **Misplaced responsibility** - a concern living outside the object that owns it (a caller doing auth the client should handle internally), or a boundary drawn in the wrong place → relocate it to where the data and the concern already live.
- **Invented names and schemas** - a trash name, or a made-up vocabulary or schema when upstream already has terminology → rename to the domain or upstream term, and prefer adopting an existing abstraction over inventing one you then have to maintain.
- **Monkeypatching and mock-heavy tests** - a test that monkeypatches or leans on generic mocks instead of a real interface → introduce a proper seam so the code is testable without patching.
- **Speculative generality** - an abstraction, parameter, or resource added in case it is useful, or code no longer used by anything → delete it until a second real caller appears.
- **Hacky and brittle** - a kludge that works but feels fragile or piecemeal (enumerating special cases, excluding a fixture by its exact path) → step back for a more general approach before the special cases pile up.

## Magic Numbers

A magic number is a bare numeric constant whose meaning is not obvious from context: thresholds, timeouts, array indices past 0, bitmasks, or the same literal repeated across the diff. Idiomatic 0/1, HTTP status codes, exit codes, clear unit conversions (1000 for ms), test expectations, and constants being given a name are not magic. Suggest extracting to a named constant that explains the value's purpose, matching the project's naming convention (package-level in Go, module-level in Python). Never hardcode a limit that should be sampled or derived. Use `Nit:` for isolated cases and escalate when several unexplained literals share a function or the value is non-obvious (e.g., `if size > 8192`).

## Related

Module cohesion and pass-through indirection (avoiding `utils` catch-alls, deep vs shallow modules, single-adapter seams) are developed in the `improve-codebase-architecture` skill rather than repeated here.
