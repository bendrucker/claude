Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Fixes pipeline selection in gitlab:ci-monitor to eliminate false-green reports caused by external pipelines, parent pipelines, and unrelated MRs on the same branch. MR mode now queries the MR-specific endpoint; branch mode keeps the branch-ref query. Adds fail-closed job verification before emitting success, plus property-based and e2e tests against a stub glab. 3 files changed, +790/-67.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The pipeline list endpoint returns external pipelines (posted by other tools, carrying no CI jobs) and parent-pipeline children, and either can hold the highest id and trigger a false success.
- MR mode's ref= query matched the pipeline's stored ref rather than the caller's intent, so it also returned pipelines belonging to other MRs on the same branch.
- MR mode now queries the MR-specific endpoint, branch mode keeps the branch-ref query, and both funnel through a selectPipeline filter that drops external and parent_pipeline sources.
- selectPipeline prefers the caller's own pipeline kind and falls back to the other kind only when the preferred one is absent, so a project running a single pipeline kind still works.
- A claimed success is confirmed against the pipeline's jobs before being emitted; a failed job with allow_failure=false downgrades the state to failing.
- Rejected head_pipeline as a replacement because GitLab derives it from pipelines ordered by id, so an external pipeline can become head_pipeline and reproduce the bug; rejected pipeline sha as a staleness check because merged-results pipelines report an ephemeral merge commit.
- Testing surfaced a pre-existing, unrelated bug left unfixed: the fetchInterval duration filter on finished_at always yields an empty array because the endpoint never returns that field, so the poll interval always defaults to the 30s floor.
- Verified in all three modes against a stub glab exercising the real shell and jq pipeline; a live watch against a real GitLab project was unavailable due to missing glab auth.
