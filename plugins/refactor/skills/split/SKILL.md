---
name: split
description: Break a monolithic file, function, or class into smaller modules without changing behavior. Use when splitting, breaking up, or extracting from a large file, god class, or long function, or when a module has grown several unrelated responsibilities.
argument-hint: "[<file, function, or class>]"
---

# Split

Split `$ARGUMENTS`, or the code the user named, into modules with one responsibility apiece. Every caller sees the same behavior and the same exported names as before. The deliverable is a set of moves a reviewer can verify as moves.

## Choose the Cut

Group code by the state and data it shares and by who calls it. Code that reads and writes the same fields belongs together. Code that only shares a file does not. Line count and kind of code (types, helpers, handlers) are weak signals.

- In a class, shared mutable state is the cut line. When two halves both write the same field, either the split is wrong or that state is a module of its own.
- In a function, cut at points where the live variables are few. A stretch that reads ten locals and writes five is not a unit.
- Give each new module a name for what it contains. A module named `utils`, `helpers`, or `common` means the cut is not settled.
- Split into files before splitting across directories.

Propose the cut to the user as a list of new modules, each with a one-line purpose and the names it takes, before moving code when the split creates more than three modules or changes any import path outside the file. With nobody present to answer, take the cut and lead the report with it.

## Exported Names

- Keep the original import path working. Re-export the moved names from it, or update every caller in the same change. A caller outside the repository keeps the re-export.
- Diff the exported names before and after. The set is identical unless the user approved a change.
- Leave the tests and their assertions unchanged, still importing through the original path. A test that must change is a sign behavior or surface moved.
- When the code has no tests at its interface, write characterization tests there before moving anything, from inputs real callers pass. For untested code with complex behavior, build the differential harness in [port](../port/SKILL.md) with the pre-split version as the oracle.

## Move, Then Edit

When the same split repeats across many files, split one to three by hand and follow [port's scale method](../port/references/scale.md) for the rest.

Commit pure moves separately from edits. A move commit relocates code and adjusts imports, nothing else, so `git diff --color-moved` shows it as moved lines. Renames, signature changes, and cleanup go in later commits.

- Preserve the order of side effects: module-load work, registration, and initialization that ran at import time still runs in the same order.
- Watch what a function extraction captures: early returns, `break` and `continue`, exceptions, closures over mutated locals, and `this`.
- Check for import cycles with the ecosystem's tool (`madge`, `import-linter`, `go vet`, the compiler). A cycle between two new modules means they share state and belong together.

## Done

The split is done when:

- The exported names at the original path match the set before the split.
- The original tests run green without edits.
- The cycle check reports nothing among the new modules.
- Each new module has a one-line purpose, and the move commits show only moved lines and import edits.
