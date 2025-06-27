# Bash

Prefer using Claude Code's [built-in tools] instead of executing Unix command via the `Bash` tool where possible. These include:

- `Glob`
- `Grep`
- `LS`
- `Read`

These tools do not require permissions, whereas `Bash` calls require permissions since they can execute arbitrary commands and operate outside the working directory.
