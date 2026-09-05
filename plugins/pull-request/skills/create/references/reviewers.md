# Suggesting Reviewers

Load this after creating the PR/MR on a corporate or internal repo.

Gate on repository visibility first:

- **GitHub**: `gh repo view --json visibility -q .visibility`
- **GitLab**: `glab api projects/:fullpath --jq .visibility`

A public repository is OSS: skip reviewer suggestion and let the maintainer triage. Any other visibility (private, internal) is corporate: continue.

Rank candidates from the git history of the changed files. The plugin root is stable (stated in `SKILL.md`), so substitute it for the placeholder. The script excludes you and needs no arguments:

```bash
bun <plugin-root>/scripts/suggest-reviewers.ts
```

- **Blame owners**: people who wrote the lines you're changing. Suggest the top one or two.
- **Sole-author fallback**: when the output reports you're the sole author of the area, use the recent in-area PR/MR refs it prints. Look up who you requested review from on those and suggest the recurring names.

Resolve names to platform usernames only after the user accepts, then assign them to the existing PR/MR:

- **GitHub**: `gh pr edit --add-reviewer <user>` (resolve emails to logins with `mcp__github` if needed).
- **GitLab**: load `gitlab:merge-request` for username resolution, then `glab mr update --reviewer <user>`.
