# Git Plugin

Git workflow and branching best practices for Claude Code.

## Contents

- **Skills**:
  - `conflicts`: Resolve git merge conflicts during rebase, merge, or cherry-pick. Drives the operation to completion and pushes when asked.
- **Hooks**:
  - Blocks direct commits to the default branch
  - Records `git push -u` tracking outside the sandbox, which denies the `.git/config` write a linked worktree's push makes
  - Refuses an `EnterWorktree` call the harness would reject
  - Recovers a failed git network operation over HTTPS when the SSH agent refuses to sign
  - Handles a refused commit or tag signature: asks for approval where signing is required, retries unsigned elsewhere

## HTTPS Fallback

[Secretive](https://github.com/maxgoedjen/secretive) gates every SSH signature behind Touch ID, so an unattended `git fetch`, `pull`, or `push` gets `agent refused operation` and then `Permission denied (publickey)`, exiting 128. Ordinary fetches and pulls fail the same way.

The `PostToolUseFailure` hook watches failing `git` commands for that signature. When the repository (or the command) names an SSH remote on a host whose CLI holds HTTPS credentials (the `https_hosts` option, default `github.com=gh,gitlab.com=glab`), it returns the same command rewritten to go over HTTPS:

```
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github.com:' -c 'url.https://github.com/.insteadOf=ssh://git@github.com/' fetch origin
```

The hook suggests, it does not retry. Rewriting the URL through `insteadOf` rather than substituting the remote with a bare URL keeps the remote name, its refspecs, and its remote-tracking ref updates identical to the SSH attempt. The provider CLI's `auth git-credential` helper supplies the token for the duration of that one command, so nothing is written to the repository's config and no credential is stored or echoed. The leading `credential.helper=` resets the helper list so a stale keychain entry cannot win.

A host outside `https_hosts` gets no suggestion, since no known CLI could authenticate the retry. Add a self-hosted forge or enterprise domain as another `host=cli` pair whose CLI provides `auth git-credential`.

Commit and tag signing go through `ssh-keygen -Y sign` instead, and HTTPS cannot replace a signature. The fallback stays silent on them, and the signing refusal hook handles them.

## Signing Refusal

With `gpg.format=ssh`, an SSH agent that is locked or wants approval for each signature refuses an unattended `git commit`, `tag`, or `rebase`, and `ssh-keygen` reports `Couldn't sign message (signer): agent refused operation`. The `PostToolUseFailure` hook recognizes that output and checks whether the repository requires signatures:

- `git config claude.requireSigning true` in the repository
- a `required_signatures` rule on the current branch, from GitHub's `rules/branches` API
- for a tag, a ruleset targeting tags that requires signatures

When signing is required, the hook tells the model to stop and ask the user to unlock or approve the agent. Otherwise it tells the model to retry with `-c commit.gpgsign=false`. A lookup that can't reach GitHub counts as not required, and the push then reports the rejection.

## Enter Worktree

The `PreToolUse` hook on `EnterWorktree` denies a `path` call the harness is certain to reject. Claude Code enters only a worktree of the session's own repository, refuses the current directory, and after the session's first switch it enters only paths under the main checkout's `.claude/worktrees/`. Worktrees made outside the harness, by `git worktree add` or a worktree manager, usually live elsewhere, so a skill that enters one hits these rejections on every cross-repo or worktree-to-worktree switch before it falls back to `cd`. Repository identity comes from `git rev-parse --git-common-dir`. Whether the session has switched comes from the newest `worktree-state` record in the transcript, the harness's own record of it. A session that merely started in a linked worktree can still switch once, and the hook allows that. Anything it cannot resolve, including subagent calls, passes through to the harness.

**Delete it** once the `tool-failure-rates` session query shows the "is not a registered worktree", "is not under", "does not exist, so", and "is the current working directory" `EnterWorktree` signatures gone, and the skills that call the tool make the same check first.

The hook self-times into `~/.claude/hook-metrics/` through `scripts/hook-metrics.ts`, a checked copy of `user/scripts/hook-metrics.ts` that `scripts/copies.test.ts` keeps identical.

## Testing

```bash
bun test plugins/git
```
