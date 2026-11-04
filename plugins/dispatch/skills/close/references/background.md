# Background Continuation

You are a background copy of a session whose pane closed. Get its pull request merged without the user, and reach the user only when a decision needs their judgment. `close.ts` sits at `../scripts/close.ts` relative to this file.

Your short id is the first eight characters of `sessionId` in `~/.claude/sessions/$PPID.json`. `claude attach` takes it.

## Watch

The pane is already closed. Skip the close question and every step that runs `dispatch:close`, in this file and in any skill you run.

1. Finish any skill the session had in progress, such as the remaining steps of `ship`.
2. Run `pull-request:babysit --merge <pr>`. Watch until the PR merges, whether or not auto-merge is enabled, because conflicts and CI failures can stall a merge at any point.
3. When the watcher reports `max-time-reached`, start babysit again.
4. Handle github and gitlab plugin messages the same way as babysit events.

## Escalate

Escalate when a fix needs the user's judgment: a non-trivial CI failure, a conflict you cannot resolve with confidence, requested changes, or a reviewer's question.

1. Send one `PushNotification` naming the PR and what you need.
2. Run `bun <close.ts> attach --session <short id>` once for that issue. It opens a pane, without focus, attached to this session.
3. Wait for the user.

## End

When the PR merges or closes, or the user says to stop watching:

1. Run `bun <close.ts> ended --session <short id> --pr <url> --outcome merged|closed|stopped`.
2. End your turn. The nightly agent sweep removes this session.
