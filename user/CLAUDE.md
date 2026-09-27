# Claude

## Style

- Don't join independent clauses with semicolons or em dashes. End the clause with a period. Swapping one connector for another is not a fix.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- Don't hard-wrap markdown prose you author. In an existing file, follow its wrapping.
- Include a trailing newline in all new files.
- Put explanation of code you're writing in a message before the edit.
- Load the `writing:writing` skill before the first long-form prose you write for others (PR comments, reviews, documents, issues, Slack). One load covers the rest of the session.

## Organization

- Don't create or extend catch-all modules like `utils`. Name modules for what they hold.
- Split code into files before splitting it across directories.
- Don't number steps or phases in code ("Phase 1:", "Step 2:"). Use descriptive function names called in sequence.

## Curation

Every customization costs tokens on every session. Before adding one, define what shows it's working, what shows it isn't, and where that signal surfaces. Accommodate Claude Code's native defaults. Override one only as an experiment with removal criteria.

## Workflow

- A skill that instructs a subagent fan-out or background dispatch carries my authorization for `Agent`. Run it as written. Degrade to inline only when `Agent` is absent, and say so.
- Prefer `analyst` over `general-purpose` for read-only spawns. Pass `model: haiku` or `sonnet` for a type without its own model (`general-purpose`, `Explore`, `review:angle`) or for pure lookup.
- Delegate a whole task to a separate Claude process in another pane with `herdr:herdr`.
- Run scripted cross-model or GPT review through `github:copilot`. An interactive GPT or Codex deep-dive goes through `herdr:herdr` into the `copilot-gpt` worktree, launched with `copilot --max-ai-credits 120`. "Consult fable" means the same second opinion from a Fable session.
- Use the `agent-browser` skill when a task needs a real browser. `WebFetch` is fine for static pages.
- Finish a branch with `/ship`. Use `pull-request:create` to open a PR directly, or an empty body if it's unavailable. Open PRs ready for review, draft only for speculative changes.
- Root every `find` at a directory that can hold the target. Use `fd -HI <pattern> <root>` when the root must stay broad.
- Send build output to `/dev/null`. Store temporary files in `tmp/`.
- Never disable the sandbox for file writes. Bypass only after a sandboxed run of that command failed.

## Planning

Investigate in auto mode until the approach is settled, then enter plan mode to write it down. When I ask for a plan and something is still open, tell me what you're resolving and resolve it first.

## Check-ins

Schedule `⏰` plan check-ins in Things with `things:url add` and `when=<yyyy-mm-dd>`, tagged `claude-code`. Work-tracked check-ins go there too, linking their Linear issue. Notes carry what to check, the plan path, the repo, and a launch URL:

```
claude-cli://open?q=<url-encoded prompt>&cwd=<absolute main repo path>
```

The URL prefills a new session without submitting it. Point `cwd` at the main repo, never a worktree.

## Git

- Never `git push` to the default branch unless I say so.
- Work on a topic branch with a short hyphenated name.
- Write commit messages with one `-m` per paragraph, or a heredoc for complex ones. Wrap bodies at ~72 columns.

## Worktrees

Any change meant to become its own PR starts in a worktree created with `worktrunk:wt-switch-create`, even where a harness suggests `EnterWorktree`. Stay put when already on a topic branch in one. Work handed to a sibling agent gets its worktree through `herdr:herdr`. Use `worktrunk:worktrunk` for every other `wt` task. Disposable verification worktrees may use `git worktree add tmp/<name>`.

## Claude Configuration

My Claude Code setup lives in [`bendrucker/claude`](https://github.com/bendrucker/claude), worked on at `~/src/bendrucker/claude`. The `~/.claude` symlinks point into a deployed clone at `~/.claude-repo` that `claude-upgrade` syncs from `main`. A merged change is not live until that sync runs, and editing through the symlinks writes into that clone instead of a branch. Project-scoped `.claude/` directories stay with their repo.

## Dotfiles

Machine setup lives in [`bendrucker/dotfiles`](https://github.com/bendrucker/dotfiles) at `~/.dotfiles`, in topic directories. The Claude repo installs nothing. Anything the machine or shell must provide needs a merged dotfiles PR first: binaries (topic `Brewfile` or `mise.toml`), `$PATH` entries, shell aliases and functions, exported env vars (Claude-only vars go in `settings.json`), install steps, symlinks, launchd agents, macOS permission grants, and recurring jobs.

Work in another repo that needs a change in either repo goes to a sibling agent through `herdr:herdr`. Report the PR back to me, or tell me the change where herdr is unavailable.

## Stacked PRs

Load `github:stack` before any `gh stack` command (`gitlab:merge-request` on GitLab). Pick one layout per stack and don't mix them:

- Worktree per branch, for layers worked in parallel. `wt sync` rebases in dependency order (`--fetch`, `--push`, `--prune`, `--dry-run`). Publish with `gh stack link` after `wt sync --push`.
- One worktree for the whole stack, for active reshaping. `gh stack sync` owns it end to end.

After `gh stack merge`, pull the surviving layers.

## Personal Details

- My username is `@bendrucker`. Refer to actions by that user as "you."
