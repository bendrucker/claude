# AI Reviewers

Per-reviewer "satisfied" signals for the `--auto` loop, plus how to add a reviewer and re-trigger an idle one.

## Satisfaction Signals

Third-party reviewers converge on one shape: each leaves a single summary comment, edited in place across review cycles, holding the satisfaction signal and sometimes actionable items that never become inline threads. Read the summary, not just the thread list:

- Select the summary comment by `updated_at`, not `created_at`. The current signal is an edit to a comment created rounds ago, so newest-created points at the wrong one.
- Treat the summary body as a thread source. A thread-count check alone reads an unfinished review, with actionable items parked in the summary, as satisfied.

A reviewer is done when its latest summary on the current HEAD reports nothing actionable and no unresolved bot threads remain. A stale signal from an earlier SHA does not count. Each vendor phrases "none left" differently; use the string as a fast path, fall back to the thread count:

- **CodeRabbit** (GitHub `coderabbitai`, GitLab `group_<id>_bot_<hash>`): `Actionable comments posted: 0`. Nitpick and LGTM notes are noise unless obviously correct.
- **Greptile** (GitHub `greptile-apps[bot]` / `greptileai`): top confidence score (e.g. `5/5`); actionable items live in its "fix all with AI" section.

> Verify these strings against recent PR history when a reviewer's wording drifts. The reliable cross-cutting signal is **zero new actionable bot threads on the current HEAD after a re-review**.

#### Copilot

GitHub Copilot (`copilot-pull-request-reviewer` / `github-copilot[bot]`) diverges: it posts a fresh native GitHub review each cycle instead of editing one comment in place, so take its latest review by submission, not `updated_at`. Satisfied when that review on the current HEAD adds no actionable threads ("reviewed N files and found no issues" / "no further comments").

## Re-triggering an Idle Reviewer

If a reviewer doesn't re-review within ~5 minutes of a green push, post **one** top-level comment mentioning it to re-trigger, then reset the idle timer:

- CodeRabbit: `@coderabbitai review`
- Greptile: `@greptileai review` (or the bot's documented trigger phrase)
- Copilot: re-request via the PR's reviewers, or `@copilot review`

This @-mention is the only place a bot is named. Thread replies never name or thank the reviewer (see [replies.md](replies.md)).

## Adding a Reviewer

Common reviewers need no maintenance: GitHub reports `__typename: "Bot"` for App and bot accounts, and GitLab service accounts follow the `*-bot` / `*_bot` convention or the token service-account form `group_<id>_bot_<hash>` / `project_<id>_bot_<hash>` (CodeRabbit posts under a group token account). Whatever those signals catch is handled automatically.

For an account they miss (a GitLab bot with an off-convention username) or a human reviewer you want the loop to triage, add one username per line to `reviewers.txt` in that plugin's data directory (`$CLAUDE_PLUGIN_DATA`, e.g. `~/.claude/plugins/data/github-bendrucker/reviewers.txt`). Blank lines and `#` comments are ignored; the list only adds to the structural detection.

Then add a satisfaction signal and re-trigger phrase for the new reviewer here.
