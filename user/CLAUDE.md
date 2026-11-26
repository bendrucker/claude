# Claude

## Style

- Don't join independent clauses with semicolons or em dashes. End the sentence instead. A colon or other connector in their place is not a fix.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- In chat replies, write PR, issue, MR, and tracker-key (`ABC-123`) references as links, like `[dotfiles#827](https://github.com/bendrucker/dotfiles/pull/827)`, because the terminal doesn't autolink them. Take the URL that `gh`, `glab`, or the tracker tool printed, or build it from the repo's remote. With no known URL, keep the bare ID.
- Don't hard-wrap markdown prose you author. In an existing file, follow its wrapping.
- Include a trailing newline in all new files.
- Put explanation of code you're writing in a message before the edit.
- Load the `writing:writing` skill before the first long-form prose you write for others (PR comments, reviews, documents, issues, Slack). One load covers the session.

## Organization

- Keep the diff to what the task needs. Leave unrelated code and existing comments as they are, most of all in repos I don't own. Add dependencies through the package manager rather than copying their source in.
- Don't create or extend catch-all modules like `utils`. Name modules for what they hold.
- Split code into files before splitting it across directories.
- Don't number steps or phases in code ("Phase 1:", "Step 2:"). Use descriptive function names called in sequence.

## Customizations

Before adding a skill, hook, rule, or CLAUDE.md line, define what evidence shows it works, what shows it doesn't, and where that evidence surfaces. Override a Claude Code default only as an experiment with removal criteria.

## Workflow

- A skill that instructs a subagent fan-out or background dispatch carries my authorization for `Agent`. Run it as written. When `Agent` is absent, run it inline and say so.
- Prefer `analyst` over `general-purpose` for read-only spawns. Pass `model: haiku` for pure lookup.
- When debugging Claude Code itself (harness, classifier, hooks, plugins, startup), launch the observed session with `DEBUG_SDK=1 claude`, which writes `~/.claude/debug/<session-id>.txt`. Set it in the launch environment, since Claude Code ignores it in `settings.json` `env`.
- Open a PR with `pull-request:create`, or with an empty body when it's unavailable. Open it ready when it already qualifies under the next line, and as a draft otherwise.
- Mark a draft ready once I could merge it as is: its evidence is in (tests for code, an eval or bench table in the body for a prompt, skill, or performance change), required checks pass on the head, and follow-ups such as threshold tuning are filed as todos. Flip it yourself. After ready, push only conflict, CI, and review fixes.
- Watch every PR you open without asking: `subscribe_pr_activity` in a cloud session, `pull-request:babysit` locally. Drive CI and bot review to green, then tell me it's ready to merge.
- Send build output to `/dev/null`. Store temporary files in `tmp/`.

## Blockers

When a permission, sandbox, network host, credential, tool, or machine stands between you and the task, getting past it is your job. Never end a turn, PR body, or summary with commands or chores for me to run, including a "quick answer now" alongside the real ask. I lose track of them and steps get missed.

- Look for another route in this environment first: a different tool, another source for the same data, a deferred tool you can load.
- When no route exists, ask me for the capability through the tool that grants it, and say what it unblocks. Lead with the permanent fix that keeps the gap from recurring: a settings or sandbox rule, a dotfiles install, an environment host, a stored credential, a reachable folder. Hand that fix to its own session as a PR, then finish the task once it lands.
- When a step needs my own hands (approving a login, a physical device, a secret only I hold), ask with `AskUserQuestion` and send a push. Wait for the answer, then check the result yourself and carry on.
- A step of the task left for me once your part is done, with none of your work waiting on it, goes to Things as a to-do tagged `claude-code`, not into the reply. Search for an open one first and update it rather than filing a second. The notes carry what to do, how you'll know it's done, the permanent fix that would remove the step, and a link to the session. When a later session can confirm it's done, complete it. When Things can't be reached, say so in the reply and name the step.
- Run deploys, syncs, and cleanup yourself. One that can't run here is a blocker like any other.

## Planning

Investigate in auto mode until the approach is settled, then enter plan mode to write it down. When I ask for a plan and something is still open, tell me what you're resolving and resolve it first.

## Git

- Never `git push` to the default branch unless I say so.
- Name topic branches short and hyphenated.
- Write commit messages with one `-m` per paragraph, or a heredoc for complex ones. Wrap bodies at ~72 columns.
- Update a checkout with `git merge --ff-only <ref>`. Revert your own edits with `git restore <path>`. Run a tree-wide reset, checkout, or clean only when I name it.

## Worktrees

Inside an isolated worktree, write files with `Write` or `Edit` and keep each Bash command a single plain command. The isolation guard refuses heredocs, `$(...)`, loops, and a `cd` into the main checkout before git.

## Claude Configuration

My Claude Code setup lives in [`bendrucker/claude`](https://github.com/bendrucker/claude). The `~/.claude` symlinks point into `~/.claude-repo`, a deployed clone of `main`, so an edit through the symlinks lands outside any branch. Settings that apply everywhere live in `managed/settings.json`, installed as managed settings. `user/settings.json` is the local machines' user file, and `platforms/local/` and `platforms/remote/` hold the entries a local machine or a remote session links in place of or beside `user/`'s. Project-scoped `.claude/` directories stay with their repo.

## Dotfiles

Machine setup lives in [`bendrucker/dotfiles`](https://github.com/bendrucker/dotfiles). Anything the machine or shell must provide needs a merged dotfiles PR first, because the Claude repo installs nothing. That covers binaries, `$PATH` entries, aliases and functions, exported env vars, install steps, symlinks, launchd agents, macOS permission grants, and recurring jobs. Claude-only env vars go in `settings.json` instead.

## Personal Details

My username is `@bendrucker`. Refer to actions by that user as "you."

@~/.claude/platform.md
