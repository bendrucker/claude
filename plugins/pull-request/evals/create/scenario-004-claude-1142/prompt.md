Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Implements an importance gate for bot code reviews plus an availability cooldown cache, after exhausting Greptile's free OSS review credits. A single gate keyed on diff size/surface decides both the local CLI and the hosted bot; hosted review becomes opt-in via a review label. Also fixes a sandboxed Node DNS issue (NODE_USE_ENV_PROXY=1) and grants ~/.greptile write access. 11 files changed, +296/-24.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- Greptile's 100 free OSS review credits were exhausted; free_reviews_limit_reached appeared in 15 sessions, each spending a turn to rediscover it because detect-bot only reported CLI presence, not availability.
- Over 30 days, 352 PRs opened across 3 repos, with triggerOnUpdates=true charging again on every push, so real spend ran several times higher than the reported PR count implied.
- A single importance gate, keyed on the diff rather than per-repo, now decides both whether to run the local CLI and whether to request the hosted bot.
- Hosted review became opt-in through a review label; Greptile's Labels/Include filter skips any PR without it.
- An availability cache at ~/.cache/claude/bot-review.json merges cooldown records so detect-bot can inject a fast path showing pause status instead of re-discovering the limit.
- Rejected fileChangeLimit as the gating mechanism because it abuses a skip mechanism as an opt-in and still lets single-file PRs review themselves.
- The gate's thresholds (risk surface, runtime surface, roughly 200 lines or 8 files) are guesses with an explicit removal trigger: free_reviews_limit_reached should drop to zero, and a too-tight gate would show up as manual --local requests.
- NODE_USE_ENV_PROXY=1 makes Node 24 honor the sandbox's HTTPS_PROXY, fixing DNS failures and superseding an earlier mDNSResponder theory; ~/.greptile was added to allowWrite because greptile review writes auth.json and reviews.json there.
