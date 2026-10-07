# Writing Authoring Eval

A native `claude plugin eval` suite that measures whether the writing plugin moves drafts toward what Ben would ship. Each case replays a deliverable he wrote by hand: a PR body, an issue, a README section, or a skill change. `fixture.sh` rebuilds the repo as it stood before that deliverable, `prompt.md` is the brief he would type, and the session drafts it with the writing, pull-request, and issue plugins live.

Case graders cover only what a regex decides: the skill fired, the draft kept each fact the brief supplied, and it did not collapse below a length floor. Graders every case shares live once in `graders/`, joined to cases by the globs in `suite.yaml`. Preference comes from blind pairwise judging in [`scripts/pairwise.ts`](scripts/pairwise.ts), calibrated against Ben's picks.

## Cases

A brief qualifies when its original predates Claude Code (before 2025-02-24) and comes from a public repo. Skill cases are the exception. Their originals were AI-assisted, so they replay as briefs and never serve as anchors. `dev` holds 16 cases and `holdout` 8, each split carrying every surface. `pr-002` and `pr-014` are balance cases, where the right body is short.

Every reply carries its deliverable inside `<out>` tags. Doc and skill cases also write the file, so the trope hook sees the edit.

## Running

`bun evals/native/run.ts plugins/writing/evals/authoring --ref <ref> -- --tag dev --runs <n>` runs the suite locally with the Bash sandbox disabled. `bun evals/native/check.ts plugins/writing/evals/authoring` checks every regex grader against `examples/`, where `pass.md` is Ben's original and `fail.md` a reply that keeps none of the brief's facts.

Scoring a candidate against a base column:

- `bun plugins/writing/evals/authoring/scripts/metrics.ts <results>...`: tokens per deliverable, hook denies, and trope density.
- `bun plugins/writing/evals/authoring/scripts/pairwise.ts pairs|judge|score`: blind pairs, judge picks, and the win rate with per-case permutation p-values. Pass `--before data/before` so doc and skill drafts are judged on their changed region. Each file there is the case's deliverable as its fixture leaves it.

Judgments land in the gitignored `feedback/`, and originals in `data/`.
