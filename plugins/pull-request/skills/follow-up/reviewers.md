# AI Reviewers

Per-reviewer "satisfied" signals for the `--auto` loop, plus how to add a reviewer and re-trigger an idle one.

## Satisfaction Signals

Match the latest review from each bot. Treat a reviewer as done when its signal appears **on the current HEAD** (a stale signal from an earlier SHA does not count).

#### CodeRabbit (GitLab `group_<id>_bot`, GitHub `coderabbitai`)

Each review summary includes a line `Actionable comments posted: N`. Satisfied when `N` is `0` and no new unresolved bot threads remain. CodeRabbit may also leave non-blocking "nitpick" or "LGTM" notes; nitpicks are noise unless obviously correct.

#### Greptile (GitHub `greptile-apps[bot]` / `greptileai`)

Greptile posts a confidence score (e.g. `5/5`) with its summary. Satisfied at the top score with no outstanding actionable comments. A lower score with comments means another round.

#### GitHub Copilot (`copilot-pull-request-reviewer` / `github-copilot[bot]`)

Copilot's review states it has no remaining feedback (e.g. "Copilot reviewed N files and found no issues" / "no further comments") or returns a review with zero new inline threads. Satisfied when the latest Copilot review on HEAD adds no actionable threads.

> Verify these exact strings against recent PR history when a reviewer's wording drifts. The reliable cross-cutting signal is **zero new actionable bot threads on the current HEAD after a re-review**. Use the literal strings as a fast path, and fall back to the thread count.

## Re-triggering an Idle Reviewer

If a reviewer does not re-review within ~5 minutes of a green push, post **one** top-level comment mentioning it to re-trigger, then reset the idle timer:

- CodeRabbit: `@coderabbitai review`
- Greptile: `@greptileai review` (or the bot's documented trigger phrase)
- Copilot: re-request via the PR's reviewers, or `@copilot review`

This @-mention is the only place a bot is named. Thread replies never name or thank the reviewer (see [replies.md](replies.md)).

## Adding a Reviewer

Common reviewers need no maintenance: GitHub reports `__typename: "Bot"` for App and bot accounts, and GitLab service accounts follow the `*-bot` / `*_bot` convention (`group_<id>_bot` for CodeRabbit). Whatever those signals catch is handled automatically.

For an account they miss (a GitLab bot with an off-convention username) or a human reviewer you want the loop to triage, add one username per line to `reviewers.txt` in that plugin's data directory (`$CLAUDE_PLUGIN_DATA`, e.g. `~/.claude/plugins/data/github-bendrucker/reviewers.txt`). Blank lines and `#` comments are ignored, and the list only ever adds to the structural detection.

Then add a satisfaction signal and re-trigger phrase for the new reviewer here.
