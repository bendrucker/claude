# Sweep

Retire memories that have graduated or gone stale: enumerate the memory store, classify each memory by type, and propose deletions for approval.

The store is not under version control, so every deletion is irreversible, and both classification signals are fuzzy heuristics: a merged PR does not prove a project is finished, and a nearby rule does not prove a lesson is enforced. Every verdict is a proposal, never an automatic delete. Sweep never runs in the `discover --scheduled` path or any other unattended path, and never deletes or files without asking. Cadence is monthly and on-demand.

## Enumerate

List every `*.md` in this project's auto-memory store except `MEMORY.md` (the index, which Sweep edits but never deletes). The store is the `memory/` directory under `~/.claude/projects/<project-slug>/`, whose absolute path is given in your system context. Parse each file's YAML frontmatter and read its `type`, handling both shapes present in the store: the flat `type: feedback` and the nested `metadata: { type: ... }`. Branch on the type. `type: user` and `type: reference` memories are never classified or proposed.

## Project Memories

A project memory graduates once its work has shipped and left nothing live behind.

- Extract cited PR numbers from the body with `#(\d+)`. The `#` is required so bare integers (list numbers, counts) are not read as PR references. No PR numbers means nothing to check against, so keep.
- Check each cited PR with `gh pr view <n> --json state,mergedAt`. Any cited PR not merged: keep.
- All merged: scan the body for forward-looking state that outlives the merge (`unbuilt`, `not yet`, `follow-up`, `future`, `remaining`, `removal criteria`, `known issues`, `TODO`, `still`). On a match, keep and note it as "merged but has open follow-ups" so the residual work stays visible.
- Merged with no residual state: propose delete.

## Feedback Memories

A feedback memory graduates once its lesson is enforced by a rule or hook, at which point the memory duplicates the enforcement.

- Search for an encoding of the same lesson across `.claude/rules/`, `user/rules/`, the hooks blocks in `.claude/settings.json`, and the enforcement skills, matching on keyword and concept rather than exact string. If enforced, propose delete: the rule now carries the lesson.
- Not enforced but encodable as a rule or hook: keep the memory and file an [encode todo](#encode-todos). The memory stays until the enforcement exists.
- Not encodable (taste or judgment that resists a mechanical rule): keep. There is nowhere for it to graduate to.

## Encode Todos

When a feedback memory is encodable but unenforced, file a Things todo via `things:url`, tagged `claude-code`, so the lesson can become a rule later:

- **Title**: `[encode] <memory title>`
- **Notes**: the lesson, then the candidate target (the rule file or hook that should carry it), then a `Discovery: <fingerprint>` line so Dedup suppresses a duplicate on the next Discover or Sweep run. Compute the fingerprint per [discover.md](discover.md) with `finding_type` = `encode-lesson` and `normalized_target` = the memory's basename (for example `encode-lesson|feedback_prefer_headers`), keeping the identity stable across runs.

Encode todos are filed independently of the deletion approval. The memory is kept, so filing does not wait on the selection.

## Propose and Approve

Present the propose-delete candidates as a numbered table:

| # | File | Type | Signal | Reason |
|---|------|------|--------|--------|

The signal is what triggered the proposal (all cited PRs merged, or lesson enforced by `<rule>`). The reason is one line. Use `AskUserQuestion` to collect the selection (numbers, ranges like `1-3`, `all`, or `none`). Delete only the selected files. List the kept-with-note memories (merged but with open follow-ups) below the table so nothing that looked done disappears silently, and keep them out of the deletable set.

## Delete

Deletion runs only on approved files, as your own Edit and Bash actions in the flow, never a standalone unattended `rm` script. For each approved file:

- Before deleting, grep the store for inbound `[[wikilinks]]` to the file's basename. If another memory links to it, report the referrers so the user can decide whether the link should survive.
- Remove the memory file with `rm`.
- Edit `MEMORY.md` to drop the memory's line, matching on the `(<basename>.md)` in its link target.

Keep the file removal and the index edit together. A deleted memory whose `MEMORY.md` line lingers is a broken link.

Report the counts (deleted, encode todos filed, kept with an open-follow-up note) and list each so the outcome is auditable.
