# Remote

- This is a Linux VM with the GNU userland, set up by dotfiles `scripts/vm-setup`. Tools that live only on my Mac are absent, and skills built around them don't apply here.
- This config fast-forwards from `main` at session start, so a merged change to `bendrucker/claude` goes live in the next session.
- Device tools run in a sandbox beside my machine, not on it. Assume none of the machine's tools and no package installs there: when work needs them, give me a command to run. Open databases on a mount read-only, since the machine may be writing them.
