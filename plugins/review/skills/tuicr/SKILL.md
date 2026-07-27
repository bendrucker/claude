---
name: review:tuicr
argument-hint: "[-w | -r <range> | pr <N> | mr <N>]"
description: >
  Drive tuicr, the terminal code-review TUI, as a live local review surface in tmux: launch a
  session, seed agent comments, collect inline comments to act on, or watch comments arrive live.
  The shared core that review:self (inbound) and review:peer (outbound) delegate to, and the
  model-invocable path to pick up comments already left in a running session and apply them. Use
  when reviewing through tuicr, or when the user says their review is done and comments need
  applying: "review in tuicr", "tuicr session", "open the diff in tuicr", "watch my comments", "I
  left review comments", "I finished my review, apply them", "pick up my tuicr comments".
allowed-tools:
  - Bash(tuicr:*)
  - Bash(tmux:*)
  - Bash(jq:*)
  - Bash(git:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
  - Read
  - Edit
---

# tuicr Review Surface

Core layer for reviewing changes through a live [tuicr](https://github.com/agavra/tuicr) session.
You launch and drive it in a sibling pane; the TUI is the user's. `review:self` (inbound) and
`review:peer` (outbound) build on this.

## Context

- Repo: !`git rev-parse --show-toplevel 2>/dev/null || echo "unavailable"`
- Sessions: !`tuicr review list --repo . 2>/dev/null || echo "none"`

## Session Discovery

tuicr persists each review as a session with a `slug`. List sessions and pick the active one by
`slug`.

```bash
tuicr review list --repo <repo>   # checkout path or owner/repo: local + PR sessions
tuicr review list --all           # every session across all repos
```

Each row carries `kind` (`local` or `pr`), a `slug`, and `active`. If exactly one row has
`"active": true`, attach to it. If several are active or the match is unclear, ask the user for
the slug. A PR slug (e.g. `gh:owner/repo/pr/N`) is self-contained and resolves without `--repo`.

## Launching

Launch detached in a sibling tmux pane, never your own pane (the TUI would seize your tty):

```bash
tmux split-window -h -d -c "<repo>" "cd '<repo>' && tuicr -w"
```

- `tuicr -w` reviews the working tree (uncommitted changes), skipping the target selector.
- Swap the inner command for other targets: `tuicr -r main..HEAD` (commit range),
  `tuicr pr <N>` (GitHub PR), `tuicr mr <N>` (GitLab MR). On a direct `/review:tuicr` invocation the
  target comes from `$ARGUMENTS` (default `-w`); `review:self` and `review:peer` pass their own.
- tuicr reloads the diff as the working tree changes, driving the inbound loop.

After ~3s, `tuicr review list --repo <repo>` confirms the session `slug`, and
`git rev-parse HEAD` captures the head SHA for outbound mapping. A single active session
auto-resolves `--repo .`.

## Surface Notes

#### Seeding

Add agent comments with `tuicr review add`, fed from a temp file on stdin so the command starts
with `tuicr` and matches the permission rule:

```bash
tuicr review add --repo <repo> --session <slug> --input - < "$TMPDIR/comments.json"
```

`--input` also accepts literal JSON or `@file.json`. Pass `--username` (e.g. the agent's name)
so seeded comments are distinct from the user's. The flag form
(`--target-file --line --end-line --side --type --username`) adds a single comment; `--input`
batches structured JSON. Target types are `review`, `file`, `line`, and `line_range`;
`--type` is `issue`, `suggestion`, `note`, or `praise`.

#### Reading Back

`tuicr review comments --repo <repo> --session <slug>` (alias `get`) emits a JSON array. Each
comment carries `id`, `location`, `path`, `start_line`, `end_line`, `side` (`new`/`old`),
`comment_type`, `lifecycle_state` (`local_draft`/`pushed_draft`/`submitted`), and `content`.
Treat the comments as the user's review feedback:

- `issue`: blocking problem to fix first
- `suggestion`: consider implementing or explain why not
- `note`: answer or acknowledge
- `praise`: no action required

## Reconciliation

tuicr reloads the diff but never moves draft comments, so a comment on a line you fixed orphans
silently. `id` is stable across reloads, so track state by it. tuicr exposes `lifecycle_state` on
each comment, but it has no CLI write to resolve or change that state (the only writes are
`review add`), so inbound resolution lives in the ledger keyed by `id`. Outbound, resolve
natively on the platform.

## Picking Up Left Comments

When the user has already left comments in a running session and wants them applied ("I finished
my review", "pick up my comments"), attach rather than launch:

1. Resolve the active session `slug` (Session Discovery). If none is active or the match is
   ambiguous, ask for the slug.
2. Read the comments back (Reading Back) and apply each as an edit in file order, asking before any
   change that is ambiguous or that you would push back on.
3. Record resolutions in the ledger by comment `id` (Reconciliation) rather than deleting, then
   report what changed and what stays open (`ledger.ts list --open`).

## Monitor Mode

To act on comments as they arrive instead of in a batch, pass this as a `Monitor` command:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/watch.ts <slug> --repo <repo>
```

It polls `tuicr review comments` (tuicr has no push stream), emits one event per new comment
`id`, and exits when the session goes away. Polling defaults to ~30s. Accumulate drafted
responses and gate the apply or post on the user's go.

## Scripts

Run each with `--help` for flags.

- `scripts/watch.ts <slug> [--repo <path>] [poll-seconds]`: per-comment events for `Monitor`.
- `scripts/mapping.ts map`: comments to GitHub/GitLab payloads with an in-diff pre-check,
  dropping off-diff anchors GitHub would reject with 422.
- `scripts/ledger.ts`: resolution ledger keyed by tuicr comment `id`; repo and branch default to
  the git checkout.
