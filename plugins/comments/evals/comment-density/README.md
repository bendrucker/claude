# Comment Density Eval

Ground truth for tuning the comment-density scorer in `plugins/comments/detection/density.ts`. Labels (`labels/`, tracked) grade real commits and sessions 0-3 on comment weight per `judge-rubric.md`. Measurement rows (`data/`, gitignored) come from the research runs and are the only source for work-host sessions.

- Persist: labels and rubric are tracked; `data/` and `results/` stay local and out of git. A copy of `data/` lives at `s3://ben-drucker-agents-eval-corpus/comment-density/data/` (agents account, `agents-admin` profile to write). Restore with `aws s3 sync` before scoring sessions on a machine without the research runs.
- Score: `bun plugins/comments/evals/comment-density/scripts/score.ts` re-measures labeled commits live from their local repos and scores labeled sessions from the stored rows, writing `results/scores.json`.
- Scope: the commit half measures a diff against its parent from the final file content, which is how the Stop hook scores a branch. The session half sums per-file stats across a transcript's edits, so a file edited repeatedly counts each pass and the totals run above what its tree holds. Grade thresholds are evidenced by the commit half.
- Tune: `bun plugins/comments/evals/comment-density/scripts/metrics.ts --note <tag>` joins scores with labels, prints rho/precision/recall/constraints, and appends the run to `results/history.jsonl` so threshold edits in `density.ts` are compared across runs.
