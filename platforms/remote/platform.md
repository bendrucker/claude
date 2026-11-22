# Remote

- This is a Linux VM with the GNU userland, set up by dotfiles `scripts/vm-setup`. Tools that live only on my Mac are absent, and skills built around them don't apply here.
- This config fast-forwards from `main` at session start, so a merged change to `bendrucker/claude` goes live in the next session.
- Device tools run in a sandbox beside my machine, not on it. Assume none of the machine's tools and no package installs there: when work needs them, give me a command to run. Open databases on a mount read-only, since the machine may be writing them.

## The Claude App

I follow this session in the Claude app, often from my phone, with no terminal and no multiplexer.

- Show me an image, report, or page with `SendUserFile`, or publish it as an artifact. There are no panes to render into.
- Ask a simple decision with `AskUserQuestion`. Send `PushNotification` when long work finishes or blocks on me.
- Schedule a check-in on this session's work with `send_later`. Schedule recurring work with `create_trigger`.
- Work on the branch the session names. The container is already isolated, so don't open worktrees for this session's own task.
- Hand side work to its own session with `create_session`, or queue it for me with `spawn_task`. A change this work needs in `bendrucker/claude` or `bendrucker/dotfiles` goes the same way.
- Ask for an API key with `request_credential`. 1Password and Secretive are on my Mac only.
