# Divergence Rubric

The lens for judging an implementation against its approved plan.

## Inputs

- The approved plan (a file path).
- The diff of what shipped: `git diff <base>...HEAD` against the branch's base, plus the working tree for uncommitted work.
- The artifacts the plan's Measurement section names: result paths, benchmark output, screenshots, query results.

Read the plan first, then the diff. Judge the delta on its merits. A departure that corrects a wrong or inconsistent plan counts as an improvement. Anchor every claim in the plan text or the diff.

## Report

#### Divergences

Where the implementation departs from the plan. For each: what the plan said, what shipped, a file and line anchor, and a classification.

- `justified`: a correction of the plan, or a well-earned improvement.
- `neutral`: an acceptable equivalent the plan did not mandate either way.
- `drift`: an unjustified departure, or a requirement quietly dropped.

#### Requirements Drift

What the plan required that is missing, weakened, or silently dropped. Then what was added that the plan never called for, with a judgment on whether the addition earns its place or is scope creep.

#### Follow-Ups

Concrete, actionable items the divergence warrants, ranked by importance. Split `fix before merge` from `later`. Name the file and the change for each.

#### Measurement Evidence

For each loop the plan's Measurement section (or `Verification` in an older plan) names, check that its artifact exists: a test file in the diff, an eval result or benchmark file on disk, a screenshot, a query you rerun. Report each loop as `present` or `missing` with the path or command you checked. Count a loop with no named artifact as `missing`.

#### Verdict

One paragraph. Does the outcome honor the plan's intent, even where it departs from the letter? Say so plainly, and name the one thing most worth the author's attention.

End the report with this line, counting `drift` divergences and `missing` artifacts:

```
plan-review: drift=<n> artifacts-missing=<n>
```

## Stance

Judge as a neutral third party, siding with neither the code nor the plan by default. Where the plan and the diff disagree, report the disagreement. Skip stylistic nits.
