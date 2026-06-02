---
name: review:hunk
description: >
  Drive Hunk, the terminal diff viewer, as a live local review surface in tmux. Use when
  reviewing changes through Hunk: launching a session, seeding agent notes, collecting inline
  comments to act on, or watching comments arrive live. The shared core that review:self
  (inbound) and review:peer (outbound) delegate to. Triggers on "review in Hunk", "hunk
  session", "open the diff in Hunk", "watch my comments".
allowed-tools:
  - Bash(hunk:*)
  - Bash(tmux:*)
  - Bash(jq:*)
  - Bash(git:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
---

# Hunk Review Surface

Core layer for reviewing changes through a live [Hunk](https://github.com/modem-dev/hunk)
session. You launch and drive it in a sibling pane; the TUI is the user's. `review:self`
(inbound) and `review:peer` (outbound) build on this.

## Live Sessions

!`hunk session list`

## Launching

Launch detached in a sibling tmux pane, never your own pane (the TUI would seize your tty):

```bash
tmux split-window -h -d -c "<repo>" "cd '<repo>' && hunk diff --watch --agent-notes"
```

- `--agent-notes` is required to render notes you seed; the default hides them.
- `--watch` reloads the diff on file changes, which drives the inbound loop.
- Swap the inner command for other targets (`hunk diff --staged`, `hunk diff main...HEAD`,
  `hunk show HEAD`), keeping `--watch --agent-notes`.

After ~3s, `hunk session list` confirms the `sessionId` and `repoRoot`, and `git rev-parse HEAD`
captures the head SHA for outbound mapping. `repoRoot` is canonical (`/private/tmp/...`). A
single session auto-resolves `--repo .`.

## Command Reference

For the full `hunk session *` contract (`get`, `context`, `review`, `navigate`, `reload`,
`comment`), run `hunk skill path` and read that file. It is the bundled reference, version
matched to the installed Hunk.

## Surface Notes

#### Seeding
Batch with `comment apply`, fed from a temp file so the command starts with `hunk session` and
matches the permission rule:

```bash
hunk session comment apply --repo . --stdin < "$TMPDIR/notes.json"
```

Validation is all-or-nothing. Omit fields rather than nulling them. Anchors are single-line or
whole-hunk, never ranges.

#### Reading Back
`comment list --type user --json` returns JSON. Tell the authors apart by `source` (`user` vs
`agent`), `noteId` prefix (`user:` vs `mcp:`), or `editable` (`true` vs `false`).

## Reconciliation

`--watch` reloads the diff but never moves or resolves comments, so a note on a line you fixed
orphans silently (no staleness field). `noteId` is stable across reloads, so track state by it.
Inbound: Hunk has no native resolution, so mark notes resolved in the ledger rather than
deleting them. Outbound: resolve natively on the platform.

## Monitor Mode

To act on comments as they arrive instead of in a batch, pass this as a `Monitor` command:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/watch.sh <session-id>
```

It emits one event per new user comment and exits when the session closes. Accumulate drafted
responses and gate the apply or post on the user's go.

## Scripts

Run each with `--help` for flags.

- `scripts/watch.sh <session-id>`: per-comment events for `Monitor`.
- `scripts/mapping.ts map`: notes to GitHub/GitLab payloads with an in-diff pre-check, dropping
  off-diff anchors GitHub would reject with 422.
- `scripts/ledger.ts`: resolution ledger keyed by `noteId`; repo and branch default to the git
  checkout.
