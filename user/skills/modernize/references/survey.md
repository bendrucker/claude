# The survey: filtering and presenting candidates

The survey is the skill's main deliverable. It is a ranked catalog of semantics-preserving swaps, clear enough that the user can pick from it without re-reading the code.

## Filtering: what makes the cut

A candidate enters the survey only if it passes all three disciplines:

- **Semantics-preserving** — behavior, public API, and error modes are identical after the swap. If you are unsure, it does not make the cut as adopt-now; it can appear as a flagged note.
- **Earns its keep** — name the concrete benefit. If the only benefit is "newer," drop it.
- **Floor-respecting** — the feature landed at or below the floor. If it landed above, it is a flagged bump, not a rejection.

Reject silently (do not list) anything that is pure restyling with no benefit, or that no part of the code actually exhibits. The survey's value is its signal-to-noise ratio.

## Adopt-now vs flagged bump

Every candidate is one or the other:

- **Adopt-now** — the feature is available at the floor. Safe to apply without changing what the project supports.
- **Flagged bump** — the feature is worth having but requires raising the floor (a newer language version, or a major-dependency upgrade). Report it with the exact version it needs and what raising the floor would cost (dropped consumers, CI matrix change, upgrade work). Never apply a bump as part of adopt-now. The user decides bumps deliberately.

Keep these visually distinct in the report so the user never confuses a free swap with a support-policy decision.

## Recommendation strength

Tag each candidate, mirroring the architecture skill's vocabulary:

- **Strong** — clear benefit, mechanical and low-risk (often a codemod exists), exhibited widely.
- **Worth exploring** — real benefit but some judgment or scope to it.
- **Speculative** — plausible but benefit or safety is uncertain.

## Report format

Present in-conversation, grouped by axis (language features, major dependencies, stdlib subsumption), ranked by leverage within each group. Offer to also write the report to `tmp/modernize-<timestamp>.md` for the user to keep. Each candidate is a compact card:

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

Lead the report with a one-line stack summary (languages, floors, and the gaps researched) so the user sees the budget the survey was drawn from. End with a **Top pick**: the one candidate you would apply first and why.

Then ask which candidates to apply (numbers, ranges, or `all`). Do not edit code in this phase. When the user picks, proceed to [apply.md](apply.md).
