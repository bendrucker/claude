# Divergence Rubric

The lens for judging an implementation against its approved plan.

## Inputs

- The approved plan (a file path).
- The diff of what shipped: `git diff <base>...HEAD` against the branch's base, plus the working tree for uncommitted work.

Read the plan first, then the diff. Judge the delta on its merits, not the plan's letter. A plan can be internally inconsistent or wrong, so a departure that corrects it counts as an improvement. Anchor every claim in the plan text or the diff.

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

#### Verdict

One paragraph. Does the outcome honor the plan's intent, even where it departs from the letter? Say so plainly, and name the one thing most worth the author's attention.

## Stance

Neutral third party. You did not write this code, so do not defend it, and do not assume the plan was right. Where the plan and the diff disagree, report the disagreement rather than resolving it in either's favor by default.
