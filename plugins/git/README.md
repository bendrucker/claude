# Git Plugin

Git workflow and branching best practices for Claude Code.

## Contents

- **Skills**:
  - `conflicts`: Resolve git merge conflicts during rebase, merge, or cherry-pick. Drives the operation to completion and pushes when asked.
- **Hooks**:
  - Blocks direct commits to the default branch
  - Recovers a failed git network operation over HTTPS when the SSH agent refuses to sign
  - Stops retries of a refused commit or tag signature and asks for Touch ID approval

## HTTPS Fallback

[Secretive](https://github.com/maxgoedjen/secretive) gates every SSH signature behind Touch ID, so an unattended `git fetch`, `pull`, or `push` gets `agent refused operation` and then `Permission denied (publickey)`, exiting 128. Ordinary fetches and pulls fail the same way.

The `PostToolUseFailure` hook watches failing `git` commands for that signature. When the repository (or the command) names an SSH remote on a host whose CLI holds HTTPS credentials (`github.com` via `gh`, `gitlab.com` via `glab`), it returns the same command rewritten to go over HTTPS:

```
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github.com:' -c 'url.https://github.com/.insteadOf=ssh://git@github.com/' fetch origin
```

The hook suggests, it does not retry. Rewriting the URL through `insteadOf` rather than substituting the remote with a bare URL keeps the remote name, its refspecs, and its remote-tracking ref updates identical to the SSH attempt. The provider CLI's `auth git-credential` helper supplies the token for the duration of that one command, so nothing is written to the repository's config and no credential is stored or echoed. The leading `credential.helper=` resets the helper list so a stale keychain entry cannot win.

A host outside the provider table (a self-hosted forge, an enterprise domain) gets no suggestion, since no known CLI could authenticate the retry. Extending support is one row in `PROVIDERS` in `scripts/https-fallback.ts`.

Commit and tag signing go through `ssh-keygen -Y sign` instead, and HTTPS cannot replace a signature. Those still need Touch ID. The fallback stays silent on them, and the signing refusal hook handles them.

## Signing Refusal

An unattended `git commit`, `tag`, or `rebase` that signs through Secretive fails with `Couldn't sign message (signer): agent refused operation`. Retrying fails the same way until someone approves the Touch ID prompt. The `PostToolUseFailure` hook recognizes that output and tells the model to stop, ask the user to approve the prompt, and retry once they confirm, with signing left enabled. Signing configuration itself belongs to dotfiles.

## Testing

```bash
bun test plugins/git
```
