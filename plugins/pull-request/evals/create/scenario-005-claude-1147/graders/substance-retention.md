---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body carries what a reviewer needs from the session notes below: the load-bearing decisions with the evidence behind them, rejected alternatives a reviewer would otherwise re-propose, and deferred work. Leaving out a note that would not change a reviewer's reading is correct pruning. Fail when a needed decision is missing, or appears without the evidence that supports it.

- Motivating case: reviewing a change in another repo, Copilot caught a compose function that streamed two files to stdout without checking either read succeeded, a defect two Claude reviewers had missed.
- The Copilot Pro plan is a fixed allowance, so every design choice follows from budget: disable-model-invocation keeps natural-language routing and skill-to-skill delegation from reaching it, and --angles is capped at three with one call by default.
- Discovered the target model gpt-5.6-codex doesn't exist by probing copilot help config to enumerate accepted names; the GPT-5.6 family turned out to be sol/terra/luna, with sol not entitled on this account, terra the default at 3.89 AI credits, and luna the cheapest at 0.39.
- Multiple angles are disjoint rather than repeated passes: angle one covers unchecked failure and correctness, angle two covers data loss and security, angle three adds contracts, concurrency, and resources.
- Testing against the skill's own diff found four defects: café.ts came back quoted and escaped under default core.quotePath and failed a stat check; changed files were read through symlinks with no containment check, so linking to ~/.ssh would have inlined a private key; --max-bytes wasn't validated so a non-numeric value produced NaN and disabled the size cap; and --base reached git unverified, so --base=--output=/tmp/x turned a diff into a file write.
- Also fixed: --force bypassed the only size guard, trading a clear refusal for an opaque E2BIG, and file contents accumulated with no running total, so many small files could each pass the per-file cap and still blow out the prompt together.
- Accepted rather than fixed: diff and file contents go to GitHub unredacted; this is the mechanism, not a bug, and is now documented as a pre-review checklist item.
- The sandbox blocks Copilot from writing to ~/.copilot, so the script throws an empty HOME instead, which leaves the sandbox intact and keeps hooks, instructions, and history out of the review.
