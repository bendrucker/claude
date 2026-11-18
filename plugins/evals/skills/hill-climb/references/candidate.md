# Candidate

How to size, word, and count one candidate change. The hypothesis, targets, and guards come first, per `SKILL.md`.

## Size

Size the change to clear the noise floor from `Ready the Suite`: rewrite the section behind a failure bucket or add the rule it lacks. A reworded line rarely moves a star.

## Wording

Write the requirement a grader checks, never the grader or the suite. Swap out an example a `holdout` case uses, since a gain on that case would then measure the example rather than the rule.

## Tokens

Count the tokens the change adds to the body with `bun run skill-lint`. A skill body re-injects at every compaction, so an added sentence needs a starred target to stay.

## Removals

A removal is judged by whether the score holds, per [prune.md](prune.md). `/claude-api prompt-audit` proposes removals of text written for an older model's failures.
