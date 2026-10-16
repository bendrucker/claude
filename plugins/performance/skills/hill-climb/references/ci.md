# CI Climbs

Read this when the metric is a CI run: a job's or workflow's wall time, a critical path, a cache restore. The harness is a dispatched workflow. Each run costs minutes of runner time and writes to state other branches share.

## Harness

- Dispatch each arm as its own workflow run on a measurement branch, from the same base commit. Record each run's ID and the base commit in the notes file.
- Profile from step timings, job logs, and trace artifacts. Count runner queue wait separately from job time, since it is noise the change cannot touch.
- Run the A/A on the same branch setup and runner pool as the candidates.
- Re-baseline whenever the base branch moves or its caches are re-saved. A candidate measured against a days-old base cache and one measured after a re-save are different scenarios, and chaining their numbers into one headline overstates the gain.
- A round takes 20 to 40 minutes. Set the run count from the A/A and size the Budget in runner time before the first candidate.

## Shared Quotas

Caches, artifact storage, and API rate limits are shared with every other branch. A measurement that pushes one past its cap evicts or throttles the default branch, and every PR runs slower until the default branch saves again.

- Before the first run, read the repo's current cache and artifact usage against the cap.
- Size the measurement against runs × artifact size, and keep the total under the remaining headroom.
- Delete each arm's caches and artifacts once its results are recorded.
- Ask the user before any run that would cross the cap.

## Cold Branches

Caches are usually scoped per branch, so a new candidate branch starts cold while the base branch restores warm. Match cache state across arms: seed each measurement branch from the base branch's cache, or measure every arm cold. Name which in Rules.

## Holdout

Real PR runs on the default branch after the merge are the holdout. List the post-merge run IDs and compare their critical path with the final measurement, excluding PRs that change the cached inputs themselves.
