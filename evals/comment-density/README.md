# Comment Density Eval

Ground truth for tuning the comment-density scorer in `plugins/comments/detection/density.ts`. Labels (`labels/`, tracked) grade real commits and sessions 0-3 on comment weight per `judge-rubric.md`. Measurement rows (`data/`, gitignored) come from the research runs and are the only source for work-host sessions.

- Persist: labels and rubric are tracked; `data/` and `results/` regenerate and stay local.
- Score: `bun evals/comment-density/scripts/score.ts` re-measures labeled commits live from their local repos and scores labeled sessions from the stored rows, writing `results/scores.json`.
- Tune: `bun evals/comment-density/scripts/metrics.ts --note <tag>` joins scores with labels, prints rho/precision/recall/constraints, and appends the run to `results/history.jsonl` so threshold edits in `density.ts` are compared across runs.
