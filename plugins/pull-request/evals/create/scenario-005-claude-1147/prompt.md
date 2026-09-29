Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Adds /github:copilot, a cross-model review skill that runs the Copilot CLI against the diff to catch blind spots a same-model re-review shares. Uses disable-model-invocation for a fixed-budget design: one call by default, capped at three, diff-scoped with 120KB soft / 400KB hard size caps. Testing against the skill's own diff surfaced and fixed four input-validation defects. 4 files changed, +559/-0.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- Motivating case: reviewing a change in another repo, Copilot caught a compose function that streamed two files to stdout without checking either read succeeded, a defect two Claude reviewers had missed.
- The Copilot Pro plan is a fixed allowance, so every design choice follows from budget: disable-model-invocation keeps natural-language routing and skill-to-skill delegation from reaching it, and --angles is capped at three with one call by default.
- Discovered the target model gpt-5.6-codex doesn't exist by probing copilot help config to enumerate accepted names; the GPT-5.6 family turned out to be sol/terra/luna, with sol not entitled on this account, terra the default at 3.89 AI credits, and luna the cheapest at 0.39.
- Multiple angles are disjoint rather than repeated passes: angle one covers unchecked failure and correctness, angle two covers data loss and security, angle three adds contracts, concurrency, and resources.
- Testing against the skill's own diff found four defects: café.ts came back quoted and escaped under default core.quotePath and failed a stat check; changed files were read through symlinks with no containment check, so linking to ~/.ssh would have inlined a private key; --max-bytes wasn't validated so a non-numeric value produced NaN and disabled the size cap; and --base reached git unverified, so --base=--output=/tmp/x turned a diff into a file write.
- Also fixed: --force bypassed the only size guard, trading a clear refusal for an opaque E2BIG, and file contents accumulated with no running total, so many small files could each pass the per-file cap and still blow out the prompt together.
- Accepted rather than fixed: diff and file contents go to GitHub unredacted; this is the mechanism, not a bug, and is now documented as a pre-review checklist item.
- The sandbox blocks Copilot from writing to ~/.copilot, so the script throws an empty HOME instead, which leaves the sandbox intact and keeps hooks, instructions, and history out of the review.
