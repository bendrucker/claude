---
fail: []
---
Title: job: focus a live session's herdr pane

The `job` skill handed you `claude --resume <sessionId>` for every item with a live session, justified by the skill "runs in its own session and cannot attach to another." Off herdr that holds. Under herdr it doesn't: `herdr agent list` returns `agent_session.value` per pane, so the join to a `claude agents` record is exact on session UUID with no title guessing, and `herdr agent focus <pane_id>` puts you in the running session instead of in a command to paste.

Gather makes one extra inline call when `HERDR_PANE_ID` is set. A matched pane turns the brief's action line into `herdr agent focus <pane_id>`, and Act can run that itself after confirming, since focus moves your foreground off the `job` session. `herdr agent attach` stays out of `allowed-tools`. It takes over the terminal, so the brief names it and you run it.

Every branch is guarded on `HERDR_PANE_ID`. On the tmux work machine nothing calls herdr, and the resume path reads complete on its own rather than as a degraded reference to the herdr branch.

Original Task: [job: focus a live session with herdr instead of handing over a resume command](https://things.bendrucker.me/show?id=R69VFoDJLT64QVGmMjbaNz)
