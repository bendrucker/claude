---
name: consolidate
description: Merge duplicate or diverged copies of the same logic into one shared implementation without changing what any caller sees. Use when deduplicating, unifying, or consolidating copies, forks, or near-identical implementations spread across a codebase or across repositories.
argument-hint: "[<the duplicated logic>]"
---

# Consolidate

Replace the copies of `$ARGUMENTS`, or the logic the user named, with one shared implementation. Every caller of every copy sees the same behavior it saw before. Each copy is the *oracle* for its own callers.

When the copies reimplement a solved problem, such as escaping, parsing, or retries, use [upstream](../upstream/SKILL.md) instead and replace each copy with the library.

## Inventory

Find every copy before writing the shared version. Search for the behavior as well as identical text: renamed variables, reordered branches, and a copy rewritten in another style still count. Use `ast-grep` for structural matches. Record each copy with its callers.

## Divergences

Copies drift, so expect them to disagree. Build the differential harness from [port](../port/SKILL.md) with every copy and the shared version as columns, fed the union of inputs each copy's callers pass. Each disagreement between copies is a ledger row.

Classify each row:

- **Drift.** One copy has a bug or a stale rule the others fixed. Pick the behavior the shared version keeps, and get the user's sign-off, because callers of the losing copy see a change. Never pick by majority.
- **Variation.** Callers need different behavior. Make it a parameter of the shared version, named for the reason the callers differ.

Stop and report when the parameters needed to cover the variations outnumber the lines consolidation removes. The copies are different things that look alike.

## Placement

Put the shared version where every caller can depend on it without an import cycle or a new dependency direction. Name it for what it holds. A shared module named `utils`, `helpers`, or `common` means the abstraction is not settled.

When the callers cannot import each other's code, such as separately packaged plugins, publish the shared version as a package that each one declares in its own manifest and lockfile. When a package is too heavy for what is shared, as in a dependency-free hook, keep one identical copy per caller and add a test that fails when the copies differ.

## Migration

Move callers to the shared version one copy at a time. Past about five copies, migrate one to three by hand and follow [port's scale method](../port/references/scale.md) for the rest. Delete each copy in the change that moves its last caller. Re-run the harness after each copy, comparing that copy's callers against the shared version.

## Done

Consolidation is done when:

- A search for each original copy finds none left.
- The harness matches for every copy's callers, or the difference is a signed-off drift row.
- Each parameter the shared version gained is named for a caller difference, and the PR body lists the drift rows with the behavior kept.
