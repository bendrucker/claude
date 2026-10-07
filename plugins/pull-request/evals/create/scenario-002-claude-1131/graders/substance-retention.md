---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body carries what a reviewer needs from the session notes below: the load-bearing decisions with the evidence behind them, rejected alternatives a reviewer would otherwise re-propose, and deferred work. Leaving out a note that would not change a reviewer's reading is correct pruning. Fail when a needed decision is missing, or appears without the evidence that supports it.

- The pipeline list endpoint returns external pipelines (posted by other tools, carrying no CI jobs) and parent-pipeline children, and either can hold the highest id and trigger a false success.
- MR mode's ref= query matched the pipeline's stored ref rather than the caller's intent, so it also returned pipelines belonging to other MRs on the same branch.
- MR mode now queries the MR-specific endpoint, branch mode keeps the branch-ref query, and both funnel through a selectPipeline filter that drops external and parent_pipeline sources.
- selectPipeline prefers the caller's own pipeline kind and falls back to the other kind only when the preferred one is absent, so a project running a single pipeline kind still works.
- A claimed success is confirmed against the pipeline's jobs before being emitted; a failed job with allow_failure=false downgrades the state to failing.
- Rejected head_pipeline as a replacement because GitLab derives it from pipelines ordered by id, so an external pipeline can become head_pipeline and reproduce the bug; rejected pipeline sha as a staleness check because merged-results pipelines report an ephemeral merge commit.
- Testing surfaced a pre-existing, unrelated bug left unfixed: the fetchInterval duration filter on finished_at always yields an empty array because the endpoint never returns that field, so the poll interval always defaults to the 30s floor.
- Verified in all three modes against a stub glab exercising the real shell and jq pipeline; a live watch against a real GitLab project was unavailable due to missing glab auth.
