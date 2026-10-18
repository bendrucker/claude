# Mac

## Workflow

- For an interactive GPT or Codex deep-dive, launch `copilot --max-ai-credits 120` through `herdr:herdr` in the `copilot-gpt` worktree. "Consult fable" means the same second opinion from a Fable session.
- Never disable the sandbox for file writes.
- Write shell for the BSD userland macOS ships, not GNU. For example, `sed -i ''` takes a suffix argument, and `date`, `stat`, and `readlink` lack the GNU flags.

## Decisions

Ask a simple decision (a confirmation, an approval, a multiple-choice pick) with `AskUserQuestion`, because it reaches my phone.

## Check-ins

Schedule a plan check-in as a Things to-do titled with `⏰`, dated for the check-in, and tagged `claude-code`. For work tracked in Linear, link the issue. The notes carry what to check, the plan path, the repo, and a launch URL:

```
claude-cli://open?q=<url-encoded prompt>&cwd=<absolute main repo path>
```

Point `cwd` at the main repo, never a worktree.

## Worktrees

Start any change meant to become its own PR in a worktree created with `worktrunk:wt-switch-create`, even where the harness suggests `EnterWorktree`. When already on a topic branch in a worktree, stay there. Work handed to a sibling agent gets its worktree through `herdr:herdr`.

## Configuration Repos

Edit `bendrucker/claude` at `~/src/bendrucker/claude`. `claude-sync` updates `~/.claude-repo` from `main`, so a merged change goes live only after that sync runs. Dotfiles are deployed at `~/.dotfiles`.

When work in another repo needs a change in either repo, hand it to a sibling agent through `herdr:herdr` and report the PR back to me. Where herdr is unavailable, queue it with `spawn_task`, or tell me the change.

Reach secrets through 1Password `op run`. SSH keys live in Secretive, which refuses to sign while the Mac is locked.
