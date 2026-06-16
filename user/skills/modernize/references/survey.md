# Building the survey

The survey is the skill's main deliverable. It is a ranked catalog of semantics-preserving swaps, clear enough that the user can pick from it without re-reading the code.

## Filtering

A candidate enters the survey only if it passes all three disciplines.

- **Semantics-preserving.** Behavior, public API, and error modes are identical after the swap. If you are unsure, it does not enter as adopt-now. It can appear as a flagged note.
- **Earns its keep.** Name the concrete benefit. If the only benefit is "newer," drop it.
- **Floor-respecting.** The feature landed at or below the floor. If it landed above, it is a flagged bump, not a rejection.

Reject silently, without listing, anything that is pure restyling with no benefit or that no part of the code exhibits. The survey's value is its signal-to-noise ratio.

## Adopt-now versus flagged bump

Every candidate is one or the other.

- **Adopt-now.** The feature is available at the floor. Safe to apply without changing what the project supports.
- **Flagged bump.** The feature is worth having but requires raising the floor, through a newer language version or a major-dependency upgrade. Report it with the exact version it needs and what raising the floor costs: dropped consumers, a CI matrix change, upgrade work. Never apply a bump as part of adopt-now. The user decides bumps deliberately.

Keep these visually distinct so the user never confuses a free swap with a support-policy decision.

## Recommendation strength

Tag each candidate.

- **Strong.** Clear benefit, mechanical and low-risk, often with a codemod, exhibited widely.
- **Worth exploring.** Real benefit, but some judgment or scope to it.
- **Speculative.** Plausible, but the benefit or safety is uncertain.

## Report format

Present in-conversation, grouped by axis (language features, major dependencies, stdlib subsumption), ranked by leverage within each group. Offer to also write the report to `tmp/modernize-<timestamp>.md`. Each candidate is a compact card.

```
### <short title>            [Strong] · [adopt-now | bump → needs vX.Y]
Feature: <language/dependency feature>, since <version> (<source URL>)
Files: <paths / count of sites>
Benefit: <less boilerplate | dropped dep D | stronger types | perf | clarity>
Codemod: <command, if one exists> | none
Before:
    <minimal old snippet>
After:
    <minimal new snippet>
```

Lead with a one-line stack summary (languages, floors, gaps researched) so the user sees the budget the survey came from. End with a **Top pick**, the one candidate you would apply first, and why.

Then ask which candidates to apply (numbers, ranges, or `all`). Do not edit code in this phase. When the user picks, proceed to [apply.md](apply.md).
