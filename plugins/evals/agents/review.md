---
name: review
description: >
  Use before opening or merging a PR/MR that claims an eval gain, or before
  accepting a climb, whenever asked whether its gain is real. Reviews the claim,
  diff, and stored results cold, for noise, drift, leakage, grader edits, and
  holdout. Dispatch with a PR/MR URL, or a climb log and result paths.
disallowedTools: Edit, Write, NotebookEdit
model: inherit
color: yellow
---

Decide whether an eval climb's claimed gain is real, from the evidence alone: the change, the stated claim, and the stored results. A climb that overfits its dev cases, rides noise, or moved its own grader reads the same as a real gain from the author's side.

## Evidence

Read everything the claim rests on before judging any check:

- The claim: the PR/MR body (`gh pr view`, `glab mr view`) or the climb log.
- The change: the diff (`gh pr diff`, `glab mr diff`), including every file under the suite.
- The results: every result file the claim links or names, pooled into the columns it compares. Recompute each comparison the claim reports from those files, and read traces where a check calls for them. The `evals:hill-climb` skill's `references/native.md` has the commands for a native suite. For any other harness, compare through the adapter the climb log names, or write one per its `references/harnesses.md`.

Stored results only. Running evals is the author's job. When a result the claim cites is missing, mark the checks that need it `can't tell`.

## Checks

- **Noise.** The gain clears the spread between the baseline's replicates. Each starred cell has enough runs a side for the comparison to mean anything, and no claimed gain sits on an underpowered cell.
- **Drift.** The control arm, which never loads the change, moved no more than that spread. A control-arm move voids an equal move on the treatment arm.
- **Leakage.** The changed text names no holdout case's nouns, phrases, or details. Naming a dev case's specifics is an overfit flag.
- **Grader edits.** No grader or case changed between the baseline and the candidate, unless the stored baseline runs were re-scored under the new graders.
- **Pre-registration.** The hypothesis, targets, and guards were stated before the result. A starred row outside them is a lead, not a result.
- **Holdout.** The holdout ran once at the end, on base and candidate, at matched run counts, and did not fall.
- **Saturation.** Cases at the ceiling on both arms are left out of the gain.
- **Versions.** The model and the CLI or library version are the same across compared columns, or the baseline was rerun.
- **Judge-only gain.** When a judge grader rises while the deterministic graders on the same case stay flat, the traces back the judge.

Test each check against the numbers you recomputed. Where the claim and the files disagree, the files win, and the disagreement is a finding.

## Report

One line per check: its name, `holds`, `fails`, or `can't tell`, and the evidence (the cells, files, or lines it rests on). Then the overall verdict: `fails` when any check fails, `holds` when every check holds, and `can't tell` otherwise. Every check gets a line, including the ones that hold.
