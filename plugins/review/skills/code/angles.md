# Finder Angles

Each angle is an independent lens. Run the ones your effort cell selects (see [efforts.md](efforts.md)). Every candidate carries `file`, `line`, a one-line `summary`, and a concrete `failure_scenario` — the user-visible consequence (error, wrong output, data loss), not an intermediate state (value stale, set grows).

Do not let one angle's conclusions suppress another's. If two angles flag the same line for different reasons, record both.

## Correctness Angles

### Angle A — line-by-line diff scan

Read every hunk in the diff, line by line. Then Read the enclosing function for each hunk — bugs in unchanged lines of a touched function are in scope (the PR re-exposes or fails to fix them). For every line ask: what input, state, timing, or platform makes this line wrong? Look for inverted/wrong conditions, off-by-one, null/undefined deref, missing `await`, falsy-zero checks, wrong-variable copy-paste, error swallowed in catch, unescaped regex metachars.

### Angle B — removed-behavior auditor

For every line the diff DELETES or replaces, name the invariant or behavior it enforced, then search the new code for where that invariant is re-established. If you can't find it, that's a candidate: a removed guard, a dropped error path, a narrowed validation, a deleted test that was covering a real case.

### Angle C — cross-file tracer

For each function the diff changes, find its callers (Grep for the symbol) and check whether the change breaks any call site: a new precondition, a changed return shape, a new exception, a timing/ordering dependency. Also check callees: does a parallel change in the same PR make a call unsafe?

### Angle D — language-pitfall specialist

Scan for the classic pitfalls of the diff's language/framework — for example: JS falsy-zero, `==` coercion, closure-captured loop var; Python mutable default args, late-binding closures; Go nil-map write, range-var capture; SQL injection; timezone/DST drift; float equality. Flag any instance the diff introduces.

### Angle E — wrapper/proxy correctness

When the PR adds or modifies a type that wraps another (cache, proxy, decorator, adapter): check that every method routes to the wrapped instance and not back through a registry/session/global — e.g. a caching provider holding a `delegate` field that resolves IDs via `session.get(...)` instead of `delegate.get(...)` will re-enter the cache or recurse. Also check that the wrapper forwards all the methods the callers actually use.

## Cleanup Angles

### Reuse

The angles above hunt for bugs; this one and the next two hunt for cleanup in the changed code. Flag new code that re-implements something the codebase already has — Grep shared/utility modules and files adjacent to the change, and name the existing helper to call instead.

### Simplification

Flag unnecessary complexity the diff adds: redundant or derivable state, copy-paste with slight variation, deep nesting, dead code left behind. Name the simpler form that does the same job.

### Efficiency

Flag wasted work the diff introduces: redundant computation or repeated I/O, independent operations run sequentially, blocking work added to startup or hot paths. Also flag long-lived objects built from closures or captured environments — they keep the entire enclosing scope alive for the object's lifetime (a memory leak when that scope holds large values); prefer a class/struct that copies only the fields it needs. Name the cheaper alternative.

## Altitude

Two shapes, both anchored in what the diff set out to do.

The change does not reach its own goal. Name what the diff prevents, from its commit message, a comment it adds, or the bug it cites, then trace whether the changed line prevents it: a guard added inside a scope the failure escapes, a fix applied at one call site when every caller shares the defective path, a hardcoded list inside a mechanism whose stated purpose is staying current. Cite the path that still reaches the bad state.

The diff creates an invariant nothing enforces where it breaks. An import another module now depends on, a parameter callers must now pass, a required call order, a referenced path that must exist. The type, guard, or anchoring comment sits a level above the code that depends on it. Name the edit or call that violates it and what fails.

Both need a fix inside the code this change introduced. Skip structure the diff did not create, defects whose real fix lives in another repository or another vendor's product, and code that only differs from how its neighbors are organized: a builder to match sibling modules, a lookup table where a branch is, a shared schema over a local guard. Drop a candidate whose own reasoning concedes the current form is a deliberate tradeoff.

## Conventions (CLAUDE.md)

Find the CLAUDE.md files that govern the changed code: the user-level `~/.claude/CLAUDE.md`, the repo-root `CLAUDE.md`, plus any `CLAUDE.md` or `CLAUDE.local.md` in a directory that is an ancestor of a changed file (a directory's CLAUDE.md only applies to files at or below it). Read each one that exists, then check the diff for clear violations of the rules they state.

Only flag a violation when you can quote the exact rule and the exact line that breaks it — no style preferences, no vague "spirit of the doc" inferences. In the finding, name the CLAUDE.md path and quote the rule so the report can cite it. If no CLAUDE.md applies, return nothing for this angle.

## Cleanup Precedence

Cleanup, altitude, and conventions candidates use the same `file`/`line`/`summary` shape; in `failure_scenario`, state the concrete cost (what is duplicated, wasted, harder to maintain, or which CLAUDE.md rule is broken) instead of a crash. Correctness bugs always outrank cleanup, altitude, and conventions findings when the output cap forces a cut.

## Sweep Gap Focus

The sweep pass hunts only for what the first pass tends to miss: moved/extracted code that dropped a guard or anchor; second-tier footguns (dataclass default evaluated once, `hash()` non-determinism, lock-scope shrink, predicate methods with side effects); setup/teardown asymmetry in tests; config defaults flipped.
