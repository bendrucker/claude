# AI Reviewers

Per-reviewer "satisfied" signals for the `--auto` loop, plus how to add a reviewer and re-trigger an idle one.

## Satisfaction Signals

Third-party reviewers converge on one shape: each leaves a single summary comment, edited in place across review cycles, holding the satisfaction signal and sometimes actionable items that never become inline threads. They submit no native GitHub review, so the reviews list (`gh api .../pulls/N/reviews` filtered to the bot) never populates and polling it hangs until timeout. Read the summary, not just the thread list or the reviews list:

- Select the summary comment by `updated_at`, not `created_at`. The current signal is an edit to a comment created rounds ago, so newest-created points at the wrong one.
- Treat the summary body as a thread source. A thread-count check alone reads an unfinished review, with actionable items parked in the summary, as satisfied.

A reviewer is done when its latest summary on the current HEAD reports nothing actionable and no unresolved bot threads remain. A stale signal from an earlier SHA does not count. An **absent** summary on HEAD means the review is still pending, so when a review is expected, wait for the summary to land before reading it. Each vendor phrases "none left" differently; use the string as a fast path, fall back to the thread count:

- **CodeRabbit** (GitHub `coderabbitai`, GitLab `group_<id>_bot_<hash>`): `Actionable comments posted: 0`. Nitpick and LGTM notes are noise unless obviously correct.
- **Greptile** (GitHub `greptile-apps[bot]` / `greptileai`): top confidence score (e.g. `5/5`); actionable items live in its "fix all with AI" section.

> Verify these strings against recent PR history when a reviewer's wording drifts. The reliable cross-cutting signal is **zero new actionable bot threads on the current HEAD after a re-review**.

#### Copilot

GitHub Copilot (`copilot-pull-request-reviewer` / `github-copilot[bot]`) diverges and is the one exception to the reviews-list warning above: it posts a fresh native GitHub review each cycle instead of editing one comment in place, so take its latest review by submission, not `updated_at`. Satisfied when that review on the current HEAD adds no actionable threads ("reviewed N files and found no issues" / "no further comments").

## When a Review Is Expected

Whether a review is expected decides how to read an absent summary: pending (keep waiting) versus nothing-to-do (stop). This is the one definition every entry path shares. A bot review is expected when any of these hold:

- a review bot is assigned or already present as a reviewer,
- a bot-review status check is pending on HEAD,
- a reviewer in the list above is configured for the repo, shown by its app or webhook being installed or by recent review activity.

The status-check signal only appears after the PR exists and the bot's webhook has fired, so a check made at creation time sees only the first and third. Re-evaluate against the live PR before merging, where the pending check has appeared. With none of these signals present, no review is expected: an empty result is nothing to do.

A live cooldown disqualifies a provider outright, whatever the signals above say. `detect-bot.ts` reports one as `paused until <date> (<reason>)`. A bot that is out of reviews will not answer, so its absent summary is nothing to do.

A bot comment reporting its own pause or rate limit ends the loop the same way. Record it to `~/.cache/claude/bot-review.json` per [local.md](local.md), then stop.

## Re-triggering an Idle Reviewer

If a reviewer doesn't re-review within ~5 minutes of a green push, post **one** top-level comment mentioning it to re-trigger, then reset the idle timer:

- CodeRabbit: `@coderabbitai review`
- Greptile: `@greptileai review` (or the bot's documented trigger phrase)
- Copilot: re-request via the PR's reviewers, or `@copilot review`

This @-mention is the only place a bot is named. Thread replies never name or thank the reviewer (see [replies.md](replies.md)).

## On-Demand Review

A repo can be configured to review only on request, which changes an absent summary from pending to nothing-to-do. Greptile offers three levers, none of them visible in `.greptile/config.json` alone:

- **Filters → `Labels / Include`** skips every PR without one of the named labels. This is the opt-in: `pull-request:create --label <name>` requests the review at creation, and adding the label later requests it after the fact.
- **`triggerOnUpdates`** off stops the automatic re-review on each push. A pushed fix then needs an explicit re-trigger (see [The Autonomous Loop](SKILL.md#the-autonomous-loop)).
- **`triggerOnDrafts`** off skips drafts entirely.

`greptile config --json` prints the effective merge of repo config, dashboard, and org rules, so read the live values there rather than from the committed file. `@greptileai review` overrides all three.

## Adding a Reviewer

Common reviewers need no maintenance: GitHub reports `__typename: "Bot"` for App and bot accounts, and GitLab service accounts follow the `*-bot` / `*_bot` convention or the token service-account form `group_<id>_bot_<hash>` / `project_<id>_bot_<hash>` (CodeRabbit posts under a group token account). Whatever those signals catch is handled automatically.

For an account they miss (a GitLab bot with an off-convention username) or a human reviewer you want the loop to triage, add one username per line to `reviewers.txt` in that plugin's data directory (`$CLAUDE_PLUGIN_DATA`, e.g. `~/.claude/plugins/data/github-bendrucker/reviewers.txt`). Blank lines and `#` comments are ignored; the list only adds to the structural detection.

Then add a satisfaction signal and re-trigger phrase for the new reviewer here.
