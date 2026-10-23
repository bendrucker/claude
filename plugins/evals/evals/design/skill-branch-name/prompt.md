/evals:design plugins/gitflow/skills/branch-name

Write an eval suite for the `branch-name` skill at `plugins/gitflow/evals/branch-name/`, for `claude plugin eval`.

The skill names a branch. Requests come as `ticket` (the user gives a ticket key) and `freeform` (no key, just a description). Tag each case with its kind.

The corrections that started this:

> user: name a branch for PLAT-210, the webhook retry cap
> assistant: `ben/PLAT-210-webhook-retry-cap`
> user: no username, no slash, and the key goes lowercase

> user: branch name for cleaning up the flaky login test
> assistant: `chore/cleanup-flaky-login-test-2026-10`
> user: no date, no slash. Verb first, four words at most

> user: what should I call the branch for the cache bug
> assistant: Here are a few options: `fix-cache-bug`, `cache-bug-fix`, `fix-stale-cache`
> user: one name. Just one, nothing else in the reply

> user: PLAT-88 timeout default
> assistant: `plat-88-timeout-default`
> user: good
