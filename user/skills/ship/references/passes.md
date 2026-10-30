# Ship Passes

Gates for ship's pre-PR reviews, `code-review` effort, and `code-review` versus `simplify`.

## Gating Matrix

Gate on the diff against the resolved base plus the working tree. `plan:review` gates on the plan and the session, and `review:human` on the diff and the repo owner.

| Trigger | Pass | Notes |
|---|---|---|
| A substantial plan in context (`~/.claude/plans/` file) and a long or redirected session | `plan:review` | Read-only: background dispatch, joined before `review:human` |
| Code changes | `code-review <effort> --fix` or `simplify` | Exactly one. Skip on docs/config-only |
| New code comments | `comments:audit` | Runs first, on a clean tree |
| A supported review bot is available for the repo and the diff clears the [Bot Review Gate](#bot-review-gate) | `pull-request:follow-up --local` | Reviews committed work, commits its fixes |
| Code changes on a repo whose remote owner is `bendrucker`, clearing the [Cross-Model Gate](#cross-model-gate) | `github:copilot` | Same slot as the local bot pass. Findings fix in-branch |
| A document a model executes (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, skill `references/`, `.claude/agents`, `.claude/commands`, `.claude/rules`, `prompt/` or `prompts/` dirs) | `prompting:scan` | Fix confirmed findings with the `prompting` skill |
| Prose people read (READMEs, docs, `.mdx`, `.rst`), excluding prompt files | `writing:review` | A diff with both kinds runs both passes, each over its own files |
| A runtime surface | `run` | Skip on docs-only and tests-only |
| A diff that is not trivial, or `--human` | `review:human` | Last pre-PR pass. See [Human Review Gate](#human-review-gate) |

Run only the reviewers the change warrants. `--skip <pass>` drops any of them, and the aliases `review:code` (for `code-review`) and `verify` (for `run`) skip the same pass.

## Bot Review Gate

Both channels, the local CLI and the hosted review of the pushed branch, draw the same metered credits. One gate decides both, keyed on the diff alone.

Check availability first through `pull-request:follow-up`. Its `detect-bot.ts` reports each provider's repo config, CLI presence, and live cooldown. A paused provider counts as unavailable: skip the pass.

Spend a review when any of these hold:

- the diff touches auth, permissions, sandbox config, secret handling, or network egress
- it adds or changes a runtime surface: a hook, a script entry point, a CLI command, an API
- it is over roughly 100 changed lines or 4 files, excluding tests, docs, and lockfiles
- `code-review` confirmed a real bug, or the session redirected enough that the diff wandered

Skip everything else, including prose, dependency bumps, reverts, and config diffs clear of the first bullet's risk surfaces.

#### Which Channel

A spend verdict buys one review through one channel. Default to the local pass, which reports before the PR exists so fixes land in the branch. Fall back to the hosted pass, `--label review` on `pull-request:create`, only when the local CLI cannot run: not installed, auth fails, or the liveness probe in `local.md` finds it dead. A live cooldown skips the pass on both channels.

My Greptile org reviews only PRs labeled `review`, once at open, and never drafts. `reviewers.md` covers the `@greptileai review` override.

## Cross-Model Gate

`github:copilot` reviews the diff with GPT. It is independent of the Bot Review Gate's budget. Spend when the diff clears that gate's criteria list.

`github:copilot --status` prints the current tier (credits remaining over days to reset): constrained under 25 a day, abundant over 60. Tighten the bar when constrained and loosen it when abundant. Run a review only for a qualifying change.

The `bendrucker` owner condition is applied here, not by the script. Check the remote before invoking.

## Effort Inference

Infer `code-review` effort from the diff unless `--effort` overrides.

| Diff shape | Effort |
|---|---|
| Tiny: one file, a handful of lines | `low` |
| Ordinary change | `medium` |
| Risky: multiple plugins, hooks, permissions, sandbox, or auth-shaped code | `high` |
| Explicit request only | `xhigh` |

## Code-Review Versus Simplify

Pick `simplify` for a pure refactor or cleanup with no new behavior: extraction, renaming, dedup, dead-code removal, moving code. Pick `code-review` for new behavior, a bug fix, or a feature, including a refactor that also changes behavior. `--simplify` forces `simplify`.

## Human Review Gate

`review:human` ends the turn until Ben answers. Skip it when the diff is trivial: it adds no behavior, stays clear of the Bot Review Gate's first-bullet risk surfaces, fits the size bound, and every changed line is one of:

- a dependency declaration or version: a manifest entry, a `Brewfile` line, a tool pin, and the lockfile churn behind it
- a config value
- a typo or wording fix in existing prose

The size bound excludes lockfiles. On a repo whose remote owner is `bendrucker`, it is roughly 30 changed lines, because Ben reviews the PR on the web. Elsewhere it is roughly 5 lines.

Everything else runs the pass: code, tests, new prose, and any prompt file. `--human` forces it on a trivial diff. `--skip human` drops it on any diff.

## Babysit and Reviews

`pull-request:babysit` owns the CI waits. `pull-request:follow-up` owns which bot reviews are expected and the wait for them. With none expected, the hand-off returns at once and ship stops at green.
