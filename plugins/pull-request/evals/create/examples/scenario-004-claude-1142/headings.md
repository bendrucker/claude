---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: pull-request,ship: spend bot reviews deliberately

Greptile's 100 free OSS review credits were exhausted; free_reviews_limit_reached appeared in 15 sessions, each spending a turn to rediscover it because detect-bot only reported CLI presence, not availability.

## What changed and why

Over 30 days, 352 PRs opened across 3 repos, with triggerOnUpdates=true charging again on every push, so real spend ran several times higher than the reported PR count implied.

## Out of Scope (Deferred, Not Part of This PR)

NODE_USE_ENV_PROXY=1 makes Node 24 honor the sandbox's HTTPS_PROXY, fixing DNS failures and superseding an earlier mDNSResponder theory; ~/.greptile was added to allowWrite because greptile review writes auth.json and reviews.json there.
