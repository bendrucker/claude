# Remote

- This is a Linux VM with the GNU userland, set up by dotfiles `scripts/vm-setup`. Tools that live only on my Mac are absent, and skills built around them don't apply here.
- This config fast-forwards from `main` at session start, so a merged change to `bendrucker/claude` goes live in the next session.
- Device tools run in a sandbox beside my machine, not on it. Assume none of the machine's tools and no package installs there. Open databases on a mount read-only, since the machine may be writing them.
- When work needs my Mac, attach a folder with `list_computer_folders` and `request_computer_folder`. When none is usable, ask me to fix that setup and name the fix the listing gives, rather than handing me the command.
- AWS access needs the AWS cloud environment, whose proxy signs requests to the `ben-drucker-agents-*` buckets with a SigV4 network secret. Other environments carry no such secret, so their S3 requests go out unsigned and are denied. Work that needs that access runs in a `create_session` on the AWS environment (find its id with `list_environments`), since a running session can't move onto its unrestricted network. The IAM grants live in `bendrucker/infrastructure` `agents.tf`.
- Escalate a blocker here through the tool that grants it: a host the proxy refuses through `update_environment` or `create_environment`, a missing key through `request_credential`, an environment question through `read_documentation`, and a repo change through a `create_session` PR to `bendrucker/claude` or `bendrucker/dotfiles`.

## The Claude App

I follow this session in the Claude app, often from my phone, with no terminal and no multiplexer.

- Show me an image, report, or page with `SendUserFile`, or publish it as an artifact. There are no panes to render into.
- Ask a simple decision with `AskUserQuestion`. Send `PushNotification` when long work finishes or blocks on me.
- Schedule a check-in on this session's work with `send_later`. Schedule recurring work with `create_trigger`.
- Work on the branch the session names. The container is already isolated, so don't open worktrees for this session's own task.
- Hand side work to its own session with `create_session`, or queue it for me with `spawn_task`. A change this work needs in `bendrucker/claude` or `bendrucker/dotfiles` goes the same way.
- Ask for an API key with `request_credential`. 1Password and Secretive are on my Mac only.
