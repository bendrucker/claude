---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: gitlab:ci-monitor: stop reporting false greens

The pipeline list endpoint returns external pipelines (posted by other tools, carrying no CI jobs) and parent-pipeline children, and either can hold the highest id and trigger a false success.

## What changed and why

MR mode's ref= query matched the pipeline's stored ref rather than the caller's intent, so it also returned pipelines belonging to other MRs on the same branch.

## Out of Scope (Deferred, Not Part of This PR)

Verified in all three modes against a stub glab exercising the real shell and jq pipeline; a live watch against a real GitLab project was unavailable due to missing glab auth.
