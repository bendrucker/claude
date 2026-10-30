# AI Reviewers

Per-reviewer scores for the [acceptance bar](SKILL.md#acceptance-bar), when a review is expected, and how to re-trigger or add a reviewer.

## Satisfaction Signals

CodeRabbit and Greptile each leave one summary comment, edited in place across review cycles, holding the score and sometimes actionable items that never become inline threads. They submit no native GitHub review, so polling the reviews list (`gh api .../pulls/N/reviews`) hangs until timeout. Read the summary:

- Select the summary comment by `updated_at`, since the current score is an edit to a comment created rounds ago.
- Treat the summary body as a thread source alongside the inline threads.

A reviewer is done when its summary on the current HEAD carries its maximum score and no unresolved bot threads remain. Match the score string first and fall back to the thread count:

- CodeRabbit (GitHub `coderabbitai`, GitLab `group_<id>_bot_<hash>`): `Actionable comments posted: 0`. Treat nitpick and LGTM notes as noise unless obviously correct.
- Greptile (GitHub `greptile-apps[bot]` / `greptileai`): confidence `5/5`. Actionable items live in its "fix all with AI" section.

When a reviewer's wording drifts, verify these strings against recent PR history. Where a vendor's wording can't be matched, use zero new actionable bot threads on the current HEAD after a re-review, and report the score you couldn't read.

#### Copilot

GitHub Copilot (`copilot-pull-request-reviewer` / `github-copilot[bot]`) posts a fresh native GitHub review each cycle, so take its latest review by submission time. It is satisfied when that review on the current HEAD adds no actionable threads ("reviewed N files and found no issues" / "no further comments").

## When a Review Is Expected

This decides how to read an absent summary: pending (keep waiting) or nothing to do (stop). A bot review is expected when any of these hold:

- a review bot is assigned or already present as a reviewer,
- a bot-review status check is pending on HEAD,
- a reviewer above is configured for the repo, shown by its app or webhook being installed or by recent review activity.

The status check appears only after the PR exists and the bot's webhook has run, so re-evaluate against the live PR before merging.

A review is also not expected, whatever the signals say, in these cases:

- A live cooldown. `detect-bot.ts` reports one as `paused until <date> (<reason>)`. A bot comment reporting its own pause or rate limit counts too: record it to `~/.cache/claude/bot-review.json` per [local.md](local.md), then stop.
- A PR left out on a review-on-request repo ([On-Demand Review](#on-demand-review)). The repo signals still hold for a PR nobody opted in, so check the opt-in: the PR has the trigger label, or someone asked for a review in this session. Without one, post no re-trigger, because that comment overrides every lever and spends a review the PR was deliberately not given.

## Re-triggering an Idle Reviewer

When a reviewer hasn't re-reviewed within ~5 minutes of a green push, post one top-level comment to re-trigger it, then reset the idle timer:

- CodeRabbit: `@coderabbitai review`
- Greptile: `@greptileai review` (or the bot's documented trigger phrase)
- Copilot: re-request via the PR's reviewers, or `@copilot review`

## On-Demand Review

Greptile offers three levers for reviewing only on request, none visible in `.greptile/config.json` alone:

- Filters → `Labels / Include` skips every PR without one of the named labels. `pull-request:create` applies the label on a diff that clears its gate, `--label <name>` requests the review outright, and adding the label later requests it after the fact.
- `triggerOnUpdates` off stops the automatic re-review on each push, so a pushed fix needs an explicit re-trigger.
- `triggerOnDrafts` off skips drafts.

`greptile config --json` prints the effective merge of repo config, dashboard, and org rules, so read the live values there. `@greptileai review` overrides all three.

## Adding a Reviewer

Bot detection is structural: GitHub reports `__typename: "Bot"` for App and bot accounts, and GitLab service accounts follow `*-bot` / `*_bot` or the token form `group_<id>_bot_<hash>` / `project_<id>_bot_<hash>`. For an account those miss, or a human reviewer you want the loop to triage, add the username to that plugin's comma-separated `reviewers` option (`pluginConfigs` under `github@bendrucker` or `gitlab@bendrucker`). Then add its satisfaction signal and re-trigger phrase here.
