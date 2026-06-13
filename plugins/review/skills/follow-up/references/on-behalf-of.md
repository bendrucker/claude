# On-Behalf-Of Mode

`--on-behalf-of <reviewer>` selects an unattended monitoring loop that re-approves in `<reviewer>`'s
name as the author pushes fixes, with no human in the loop on each pass. The flag may appear with or
without a URL. Strip it, resolve the URL from whatever remains (URL or branch), then run the Trust
Gate before arming. Without the flag, follow-up is interactive and none of this runs.

This loop is the one sanctioned exception to the "don't approve automatically" guardrail. The Trust
Gate is the bound that earns it.

## Threat Model

The threat is approval forgery via commit-matching. The loop approves when a new commit addresses the
remaining open threads. On a public repo, anyone able to push a matching commit (a fork PR author, an
outside contributor) could trigger an approval recorded in the named reviewer's identity. The
reviewer never saw the code. Restricting the loop to private and internal repos collapses the
population that can push a triggering commit down to vetted members of the org, so a commit that fires
the loop came from someone already trusted.

## Trust Gate

The gate must clear before the loop arms, so it runs ahead of Execute Actions. Any approval the loop
fires depends on it.

### Detecting visibility

Use the same idiom as `review:peer` (see its [corporate](../../peer/references/corporate.md) context):

- GitHub: `gh api repos/OWNER/REPO --jq .visibility`
- GitLab: `glab api projects/ENCODED_PATH | jq -r .visibility`

Trust `private` and `internal`. Treat `public` as untrusted.

### Refusal

If visibility is `public`, do not arm the loop, do not approve, and do not post the monitoring footer.
Explain that auto-re-approval in someone else's name is unsafe on a public repo (see [Threat
Model](#threat-model)), and offer a gated single-shot review instead: run the normal follow-up
assessment once and hand me the graded call to act on myself.

Fail closed. If the API call can't determine visibility for any reason, refuse the same way. Never
assume private.

## Monitoring Loop

Gate once, at arm time. Run the Trust Gate before the first watch. If it refuses, stop here. If it
clears, arm the loop and don't re-gate on every commit (visibility doesn't change mid-session).

Drive iteration with the `Monitor` tool watching the author's commits, the same session-scoped
watcher model `pull-request:babysit` uses. On each new commit, reuse the existing pipeline unchanged:
[Classify Threads](../SKILL.md#classify-threads), then [Assess Fixes](../SKILL.md#assess-fixes),
ending in the graded call. When a commit addresses the remaining open threads, run [Execute
Actions](../SKILL.md#execute-actions) to approve in the reviewer's name.

Like babysit, the watcher is session-scoped: when the session ends, the watcher process ends with it.
Re-invoke the skill from a new session to resume monitoring.

The approval footer must name the trust basis, for example: "Monitoring on <reviewer>'s behalf;
private repo, vetted pushers."
