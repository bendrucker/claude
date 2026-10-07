---
fail: [heading-sentence-case]
---
Title: pull-request,ship: spend bot reviews deliberately

Greptile grants 100 free OSS review credits a month. Over the last 30 days this repo, `dotfiles`, and `bendrucker.me` opened 352 PRs between them, and `triggerOnUpdates: true` charged again on every push, so the real spend was several times that. Credits ran out on August 2 and resume on the 7th. Nothing remembered the pause: `free_reviews_limit_reached` appears in 15 distinct sessions, each spending a turn to rediscover it, because `detect-bot.ts` only ever reported "config present, CLI installed".

## One gate for both channels

Running the local CLI and then letting the hosted bot review the pushed branch costs two credits for one change. A single importance gate now decides both, keyed on the diff alone rather than on which repo it is. It lives in ship's `references/passes.md`, and `pull-request:create` and `pull-request:follow-up` state the same criteria inline rather than citing a user-level path that marketplace installs do not have.

Hosted review became opt-in through a `review` label. Greptile's Filters section takes `Labels / Include`, which skips any PR without the label, and `create` gained `--label` so ship requests a review when the gate says spend. The label applies in a second call after the PR exists, because an unknown label fails `gh pr create` outright and would lose the PR after every pre-PR pass had already run.

`fileChangeLimit: 1` was the rejected alternative. It abuses "skip PRs over N files unless tagged" as an opt-in, and it still lets single-file PRs review themselves.

The thresholds (risk surface, runtime surface, ~200 lines or 8 files) are a guess, so the section carries its own removal trigger: `free_reviews_limit_reached` should go to zero, and a gate that is too tight shows up as manual `--local` requests on PRs it skipped.

## An availability cache

`detect-bot.ts` merges cooldown records from `~/.cache/claude/bot-review.json` into each provider line, so the injected fast path reads `greptile: repo config, CLI installed, paused until 2026-08-07 (free credits exhausted)`. `~/.claude/plugins/data` could not hold this, since the sandbox denies writes there. `local.md` owns writing the record when a run reports a limit, and carries the removal criterion that matters most here: the write path is model-instructed prose, so a future limit hit that leaves no record means the parsing code is dead weight.

Turning `triggerOnUpdates` off has a second-order effect on the `--auto` loop, which used to push a fix and wait ~270s for an automatic re-review. On a review-on-request repo that wait is dead time, so the loop now re-triggers immediately and waits only to collect the result.

## Two sandbox blockers

`NODE_USE_ENV_PROXY=1` makes Node 24 honor the `HTTPS_PROXY` the sandbox already exports, fixing the `ENOTFOUND` that failed 45 runs across 27 sessions. This supersedes the `allowMachLookup: com.apple.mDNSResponder` theory I had been carrying, and it is the better fix regardless: the proxy still enforces the host allowlist, where granting mDNS would let Node resolve anything.

That alone was not enough. `greptile review` also writes `auth.json` and `reviews.json` in `~/.greptile` and chmods the directory, so it died at `EPERM` with networking working. `~/.greptile` is now in `allowWrite`, documented beside the atuin entry as a deliberate exception to the never-credential-stores rule. The added risk is tampering with a token that the `*.greptile.com` egress grant already makes exfiltrable. Both grants carry removal criteria.

## Evidence

Verified sandboxed, before and after:

```
node -e 'fetch("https://api.greptile.com/")'                       FAIL ENOTFOUND
NODE_USE_ENV_PROXY=1 node -e 'fetch("https://api.greptile.com/")'  ok 404
greptile whoami                                                    error: getaddrinfo ENOTFOUND
NODE_USE_ENV_PROXY=1 greptile whoami                               Signed in
```

`greptile config --json` confirms the live merge: `triggerOnUpdates` and `triggerOnDrafts` false, `filters.labels: ["review"]`, author excludes untouched. The `review` label exists in all three repos, and `.greptile/config.json` is PR'd to the other two (bendrucker/dotfiles#611, bendrucker/bendrucker.me#574).

Ran the cooldown cache end to end against a real `free_reviews_limit_reached`, plus expired, malformed, and absent files. 21 tests cover the states, including a repo-scoped record not leaking when the remote cannot be resolved.

Three things stay unverified. Whether a gated `/ship` spends one credit per PR rather than one per push waits on the August 7 reset. The 30-second liveness backstop has not met a genuinely broken CLI. And the `~/.greptile` write grant cannot take effect until this merges and a session restarts, since `~/.claude/settings.json` points at the main checkout.
