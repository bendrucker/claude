# Merging Duplicate Copies

Use this when the new implementation is one shared version replacing several copies of the same logic. Every caller of every copy sees the same behavior it saw before. Each copy is the *oracle* for its own callers.

When the copies reimplement a solved problem, such as escaping, parsing, or retries, replace each copy with a library instead, following [upstream.md](upstream.md).

## Inventory

Find every copy before writing the shared version. Search for the behavior as well as identical text. Renamed variables, reordered branches, and a copy rewritten in another style still count. Use `ast-grep` for structural matches. Record each copy with its callers.

## Divergences

Copies drift, so expect them to disagree. Build the harness with every copy and the shared version as columns, fed the union of inputs each copy's callers pass. Each disagreement between copies is a ledger row.

Classify each row:

- **Drift.** One copy has a bug or a stale rule the others fixed. Pick the behavior the shared version keeps, and get the user's sign-off, because callers of the losing copy see a change. Never pick by majority. With nobody present to sign off, pick the behavior with a stated reason, mark the row proposed, and finish the merge and the harness run anyway. The report then shows each proposal against a working shared version.
- **Variation.** Callers need different behavior. Make it a parameter of the shared version, named for the reason the callers differ.

Stop and report when the parameters needed to cover the variations outnumber the lines the merge removes. The copies are different things that look alike, and leaving them separate is the correct outcome.

## Placement and Migration

Place the shared version by the rules in [split](../../split/SKILL.md#placement). Move callers to it one copy at a time, and delete each copy in the change that moves its last caller. Re-run the harness after each copy, comparing that copy's callers against the shared version.

The merge is done when a search for each original copy finds none left, each parameter the shared version gained is named for a caller difference, and the PR body lists the drift rows with the behavior kept.
