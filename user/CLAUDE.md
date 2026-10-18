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

- Don't create or extend catch-all modules like `utils`. Name modules for what they hold.
- Split code into files before splitting it across directories.
- Don't number steps or phases in code ("Phase 1:", "Step 2:"). Use descriptive function names called in sequence.

## Customizations

Before adding a skill, hook, rule, or CLAUDE.md line, define what evidence shows it works, what shows it doesn't, and where that evidence surfaces. Override a Claude Code default only as an experiment with removal criteria.

## Workflow

- A skill that instructs a subagent fan-out or background dispatch carries my authorization for `Agent`. Run it as written. When `Agent` is absent, run it inline and say so.
- Prefer `analyst` over `general-purpose` for read-only spawns. Pass `model: haiku` for pure lookup.
- When debugging Claude Code itself (harness, classifier, hooks, plugins, startup), launch the observed session with `DEBUG_SDK=1 claude`, which writes `~/.claude/debug/<session-id>.txt`. Set it in the launch environment, since Claude Code ignores it in `settings.json` `env`.
- For an interactive GPT or Codex deep-dive, launch `copilot --max-ai-credits 120` through `herdr:herdr` in the `copilot-gpt` worktree. "Consult fable" means the same second opinion from a Fable session.
- Open a PR with `pull-request:create`, or with an empty body when it's unavailable. Open PRs ready for review. Use draft only for speculative changes.
- Send build output to `/dev/null`. Store temporary files in `tmp/`.
- Never disable the sandbox for file writes.

## Planning

Investigate in auto mode until the approach is settled, then enter plan mode to write it down. When I ask for a plan and something is still open, tell me what you're resolving and resolve it first.

## Decisions

Ask a simple decision (a confirmation, an approval, a multiple-choice pick) with `AskUserQuestion`, because it reaches my phone.

## Check-ins

Schedule a plan check-in as a Things to-do titled with `⏰`, dated for the check-in, and tagged `claude-code`. For work tracked in Linear, link the issue. The notes carry what to check, the plan path, the repo, and a launch URL:

```
claude-cli://open?q=<url-encoded prompt>&cwd=<absolute main repo path>
```

Point `cwd` at the main repo, never a worktree.

## Git

- Never `git push` to the default branch unless I say so.
- Name topic branches short and hyphenated.
- Write commit messages with one `-m` per paragraph, or a heredoc for complex ones. Wrap bodies at ~72 columns.
- Update a checkout with `git merge --ff-only <ref>`. Revert your own edits with `git restore <path>`. Run a tree-wide reset, checkout, or clean only when I name it.

## Worktrees

Start any change meant to become its own PR in a worktree created with `worktrunk:wt-switch-create`, even where the harness suggests `EnterWorktree`. When already on a topic branch in a worktree, stay there. Work handed to a sibling agent gets its worktree through `herdr:herdr`.

Inside an isolated worktree, write files with `Write` or `Edit` and keep each Bash command a single plain command. The isolation guard refuses heredocs, `$(...)`, loops, and a `cd` into the main checkout before git.

## Claude Configuration

My Claude Code setup lives in [`bendrucker/claude`](https://github.com/bendrucker/claude). Edit it at `~/src/bendrucker/claude`. The `~/.claude` symlinks point into `~/.claude-repo`, a deployed clone that `claude-sync` updates from `main`, so an edit through the symlinks lands outside any branch. A merged change goes live only after that sync runs. Project-scoped `.claude/` directories stay with their repo.

## Dotfiles

Machine setup lives in [`bendrucker/dotfiles`](https://github.com/bendrucker/dotfiles) at `~/.dotfiles`. Anything the machine or shell must provide needs a merged dotfiles PR first, because the Claude repo installs nothing. That covers binaries, `$PATH` entries, aliases and functions, exported env vars, install steps, symlinks, launchd agents, macOS permission grants, and recurring jobs. Claude-only env vars go in `settings.json` instead.

When work in another repo needs a change in either repo, hand it to a sibling agent through `herdr:herdr` and report the PR back to me. Where herdr is unavailable, queue it with `spawn_task`, or tell me the change.

Reach secrets through 1Password `op run`. SSH keys live in Secretive, which refuses to sign while the Mac is locked.

## Personal Details

My username is `@bendrucker`. Refer to actions by that user as "you."
