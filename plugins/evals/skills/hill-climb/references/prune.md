# Prune

Goal: fewer tokens in the target, with every accepted cut shown to drop the score by less than a margin fixed before the first cut. Run the rest of the loop as in `SKILL.md`. Count tokens with `bun run skill-lint`.

## Margin

Before the first cut, write the margin in the climb log: the largest drop in with-arm pass rate a cut may cost. Read the noise columns from `Ready the Suite` and set the run count so a drop of the margin's size stars at `--alpha 0.2`, since at lower power a harmful cut also fails to star.

## Cuts

Cut a rule: the sentences under one heading that produce one behavior. Its targets are the graders it was written for, and every other case is a guard. Cut only a rule a grader checks. For an unchecked rule, add a case that checks it and re-run the baseline, or leave it to the `prompting:prompting` relevance pass.

Order cuts by tokens saved: the description first, since it costs every turn, then the body, then references.

Batch cuts whose rules have disjoint targets into one candidate. When a batch fails, bisect it on the same base until one rule remains.

## Hold

Accept a cut when all of these hold on the pooled columns:

- No with-arm cell stars down at `--alpha 0.2`.
- Each target grader's with-arm pass rate falls by less than the margin.
- The `dev` tag row's with-arm score falls by less than the margin.

When a target falls to the without arm's rate, restore the rule and try a shorter wording as its own candidate.

## Drift

After every third accepted cut, and before the closing PR, compare the current commit against the original base's columns with the same margin. When the total drop exceeds it, bisect the accepted cuts and restore the costliest.

At the end, run `holdout` on the original base and the final commit. The prune holds when `holdout` falls by less than the margin. The closing PR states the tokens before and after, the margin, and the `holdout` score on both commits.
