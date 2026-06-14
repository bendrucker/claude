# Applying the chosen candidates

Runs only on the candidates the user picked from the survey, and only on adopt-now candidates unless the user explicitly accepted a flagged bump. The discipline here is that the safety net (tests, build, lint) is what lets a semantics-preserving claim be trusted.

## Find the project's own verification

Before changing anything, discover how the project checks itself, and confirm it passes *now* so you have a clean baseline. Look in the manifest scripts, `Makefile`/`Justfile`/`Taskfile`, and CI config for the real commands:

- the build/compile command,
- the test command,
- the lint/format/typecheck command.

Run them once up front. If the baseline is already red, stop and tell the user — you cannot attribute a later failure to your change against a broken baseline.

If the project has thin or no tests, say so and narrow to changes that are mechanically obvious or codemod-driven. Without a safety net, the only safe modernizations are the ones whose correctness is visible in the diff itself.

## Prefer codemods over hand-edits

If research found an official codemod or migration tool for a candidate, run it rather than editing by hand. Codemods are semantics-preserving by construction, cover every site uniformly, and produce a reviewable diff. Run it, then read the diff critically — codemods can miss edge cases or reformat more than intended.

## Batch, verify, commit

Work in small, coherent batches — one feature swap or one codemod at a time, not all picks at once. After each batch:

1. Run the build, then the tests, then lint/typecheck.
2. If anything that was green goes red, the swap was not semantics-preserving. Revert the batch and either downgrade it to a flagged note in your summary or report why it failed. Do not paper over a real behavior change.
3. If green, commit the batch with a message naming the feature adopted (e.g. `Adopt native fetch, drop node-fetch`). One coherent batch per commit keeps blame legible.

Do not bundle unrelated modernizations into one commit. Each should be revertable on its own.

## Flagged bumps

If the user accepted a bump, treat the version raise as its own first step: update the manifest floor (`engines`, edition, dependency range, target framework), then adopt the feature, then verify. Call out in the summary that the project's minimum supported version changed, since that is a support-policy decision with downstream effect, not just a code change.

## Summary

After applying, report per candidate: applied / reverted / skipped, the commit, and the verification result. For anything reverted, say why. For any bump applied, restate the new floor.
